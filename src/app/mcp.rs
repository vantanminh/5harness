use std::io::Cursor;
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};
use tiny_http::{Header, Method, Response, Server, StatusCode};

use crate::error::{Error, Result};
use crate::VERSION;

use super::dashboard::RunningServer;
use super::durable::{add_decision, add_intake, add_story, get_entity};
use super::index::{ensure_index, format_search_hits, search_index};
use super::query::{query_matrix, query_stats, query_view_json};

pub fn mcp_tools() -> Value {
    json!([
        {"name":"harness_get","description":"Get a durable entity by ID or path.","inputSchema":{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}},
        {"name":"harness_search","description":"Search entity catalog with ranked hits and snippets.","inputSchema":{"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}},
        {"name":"harness_query_matrix","description":"Story matrix: all stories with status, proof, evidence.","inputSchema":{"type":"object","properties":{}}},
        {"name":"harness_query_stats","description":"Summary counts by category.","inputSchema":{"type":"object","properties":{}}},
        {"name":"harness_status","description":"Project snapshot: work counts, Project Link role/peers/reports, version, index.","inputSchema":{"type":"object","properties":{}}},
        {"name":"harness_intake","description":"Record a feature intake. Mutates durable markdown.","inputSchema":{"type":"object","properties":{"type":{"type":"string"},"summary":{"type":"string"},"lane":{"type":"string"}},"required":["type","summary","lane"]}},
        {"name":"harness_story_add","description":"Add a story. Mutates durable markdown.","inputSchema":{"type":"object","properties":{"id":{"type":"string"},"title":{"type":"string"},"lane":{"type":"string"}},"required":["id","title","lane"]}},
        {"name":"harness_decision_add","description":"Add a decision. Mutates durable markdown.","inputSchema":{"type":"object","properties":{"id":{"type":"string"},"title":{"type":"string"}},"required":["id","title"]}}
    ])
}

pub fn handle_mcp_request(root: Option<&PathBuf>, body: &str) -> Value {
    let parsed: Value = serde_json::from_str(body).unwrap_or(json!({}));
    let id = parsed.get("id").cloned().unwrap_or(Value::Null);
    let method = parsed.get("method").and_then(|m| m.as_str()).unwrap_or("");
    match method {
        "initialize" => json!({
            "jsonrpc":"2.0",
            "id": id,
            "result": {
                "protocolVersion":"2024-11-05",
                "serverInfo": {"name":"5harness","version": VERSION},
                "capabilities": {"tools": {}}
            }
        }),
        "tools/list" => json!({
            "jsonrpc":"2.0",
            "id": id,
            "result": {"tools": mcp_tools()}
        }),
        "tools/call" => {
            let Some(root) = root else {
                return json!({"jsonrpc":"2.0","id":id,"error":{"code":-32001,"message":"MCP project is unbound."}});
            };
            let params = parsed.get("params").cloned().unwrap_or(json!({}));
            let name = params.get("name").and_then(|n| n.as_str()).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(json!({}));
            let text = call_tool(root, name, &args);
            json!({
                "jsonrpc":"2.0",
                "id": id,
                "result": {"content":[{"type":"text","text": text}]}
            })
        }
        "ping" => json!({"jsonrpc":"2.0","id":id,"result":{}}),
        _ => json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":format!("Method not found: {method}")}}),
    }
}

fn call_tool(root: &PathBuf, name: &str, args: &Value) -> String {
    match name {
        "harness_get" => {
            let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("");
            match get_entity(root, id) {
                Ok(Some(file)) => format!("# {} ({})\npath: {}\n", file.data.get("id").map(|_| id).unwrap_or(id), "entity", file.relative_path),
                Ok(None) => format!("Entity not found: {id}"),
                Err(e) => e.to_string(),
            }
        }
        "harness_search" => {
            let q = args.get("query").and_then(|v| v.as_str()).unwrap_or("");
            match ensure_index(root) {
                Ok(idx) => format_search_hits(&search_index(&idx, q, 20, None)),
                Err(e) => e.to_string(),
            }
        }
        "harness_query_matrix" => query_matrix(root, false).unwrap_or_else(|e| e.to_string()),
        "harness_query_stats" => query_stats(root).unwrap_or_else(|e| e.to_string()),
        "harness_status" => super::status::format_status(root).unwrap_or_else(|e| e.to_string()),
        "harness_intake" => {
            let ty = args.get("type").and_then(|v| v.as_str()).unwrap_or("");
            let summary = args.get("summary").and_then(|v| v.as_str()).unwrap_or("");
            let lane = args.get("lane").and_then(|v| v.as_str()).unwrap_or("normal");
            match add_intake(root, ty, summary, lane, None, None, None, None, None, None) {
                Ok((_, id)) => format!("Intake {id} recorded."),
                Err(e) => e.to_string(),
            }
        }
        "harness_story_add" => {
            let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let title = args.get("title").and_then(|v| v.as_str()).unwrap_or("");
            let lane = args.get("lane").and_then(|v| v.as_str()).unwrap_or("normal");
            match add_story(root, id, title, lane, None, None, None, None) {
                Ok(_) => format!("Story {id} added."),
                Err(e) => e.to_string(),
            }
        }
        "harness_decision_add" => {
            let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let title = args.get("title").and_then(|v| v.as_str()).unwrap_or("");
            match add_decision(root, id, title, None, None, None, None, None, false) {
                Ok(_) => format!("Decision {id} added."),
                Err(e) => e.to_string(),
            }
        }
        _ => format!("Unknown tool {name}"),
    }
}

pub fn oauth_protected_resource(issuer: &str) -> Value {
    json!({
        "resource": format!("{}/mcp", issuer.trim_end_matches('/')),
        "authorization_servers": [issuer.trim_end_matches('/')],
        "bearer_methods_supported": ["header"],
        "resource_name": "5harness MCP",
        "resource_documentation": "https://github.com/vantanminh/5harness"
    })
}

pub fn start_mcp(
    host: &str,
    port: u16,
    project_root: PathBuf,
    serve_forever: bool,
) -> Result<RunningServer> {
    let listener = TcpListener::bind((host, port))
        .map_err(|e| Error::new(format!("mcp bind {host}:{port} failed: {e}")))?;
    let actual = listener.local_addr()?.port();
    let server = Server::from_listener(listener, None)
        .map_err(|e| Error::new(format!("mcp server: {e}")))?;
    let url = format!("http://{host}:{actual}/");
    let shutdown = Arc::new(AtomicBool::new(false));
    let flag = shutdown.clone();
    let host_owned = host.to_string();
    let handle = thread::spawn(move || mcp_loop(server, flag, project_root, actual, host_owned));
    if serve_forever {
        loop {
            thread::sleep(Duration::from_secs(60));
        }
    }
    Ok(RunningServer {
        url,
        port: actual,
        shutdown,
        handle: Some(handle),
    })
}

fn mcp_loop(
    server: Server,
    shutdown: Arc<AtomicBool>,
    project_root: PathBuf,
    port: u16,
    host: String,
) {
    let issuer = format!("http://{host}:{port}");
    loop {
        if shutdown.load(Ordering::SeqCst) {
            break;
        }
        match server.recv_timeout(Duration::from_millis(200)) {
            Ok(Some(mut request)) => {
                let url = request.url().to_string();
                let method = request.method().clone();
                let mut body = String::new();
                let _ = request.as_reader().read_to_string(&mut body);
                let path = url.split('?').next().unwrap_or("/");
                let (status, ctype, payload) = match (method, path) {
                    (Method::Get, "/.well-known/oauth-protected-resource") => (
                        200,
                        "application/json; charset=utf-8",
                        serde_json::to_string_pretty(&oauth_protected_resource(&issuer))
                            .unwrap_or_else(|_| "{}".into()),
                    ),
                    (Method::Get, "/mcp") => (
                        200,
                        "application/json; charset=utf-8",
                        serde_json::to_string_pretty(&json!({
                            "name": "5harness",
                            "version": VERSION,
                            "protocolVersion": "2024-11-05",
                            "transport": "streamable-http",
                            "tools": mcp_tools()
                        }))
                        .unwrap_or_else(|_| "{}".into()),
                    ),
                    (Method::Post, "/mcp") | (Method::Post, "/") => (
                        200,
                        "application/json; charset=utf-8",
                        serde_json::to_string(&handle_mcp_request(Some(&project_root), &body))
                            .unwrap_or_else(|_| "{}".into()),
                    ),
                    (Method::Options, _) => (204, "text/plain", String::new()),
                    _ => (404, "text/plain; charset=utf-8", "not found".into()),
                };
                let response = Response::new(
                    StatusCode(status),
                    vec![
                        Header::from_bytes(&b"Content-Type"[..], ctype.as_bytes()).unwrap(),
                        Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap(),
                    ],
                    Cursor::new(payload.into_bytes()),
                    None,
                    None,
                );
                let _ = request.respond(response);
            }
            Ok(None) => continue,
            Err(_) => {
                if shutdown.load(Ordering::SeqCst) {
                    break;
                }
            }
        }
    }
}

pub fn query_view_json_pub(root: &PathBuf, view: &str) -> Result<Value> {
    query_view_json(root, view)
}
