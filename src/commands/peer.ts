import { resolveProjectPeer } from "../application/project-link.js";
import { executeContext, type ContextCliOptions } from "./context.js";
import {
  executeGet,
  executeLinks,
  executeSearch,
  type GetCliOptions,
  type SearchCliOptions,
} from "./index-tools.js";

export type PeerSelectorCliOptions = {
  dir?: string;
  directory?: string;
  peer?: string;
  role?: string;
};

function peerRoot(options: PeerSelectorCliOptions): string {
  const localRoot = options.dir ?? options.directory;
  return resolveProjectPeer(
    { peerId: options.peer, role: options.role },
    localRoot,
  ).path;
}

export type PeerSearchCliOptions = PeerSelectorCliOptions &
  Pick<SearchCliOptions, "limit">;

export function executePeerSearch(
  query: string,
  options: PeerSearchCliOptions = {},
): void {
  executeSearch(query, { dir: peerRoot(options), limit: options.limit });
}

export type PeerGetCliOptions = PeerSelectorCliOptions &
  Pick<GetCliOptions, "summary">;

export function executePeerGet(
  idOrPath: string,
  options: PeerGetCliOptions = {},
): void {
  executeGet(idOrPath, {
    dir: peerRoot(options),
    summary: options.summary,
  });
}

export type PeerContextCliOptions = PeerSelectorCliOptions &
  Pick<ContextCliOptions, "depth" | "maxChars" | "json">;

export function executePeerContext(
  entityId: string,
  options: PeerContextCliOptions = {},
): void {
  executeContext(entityId, {
    dir: peerRoot(options),
    depth: options.depth,
    maxChars: options.maxChars,
    json: options.json,
  });
}

export function executePeerLinks(
  entityId: string,
  options: PeerSelectorCliOptions = {},
): void {
  executeLinks(entityId, { dir: peerRoot(options) });
}
