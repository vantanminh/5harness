const BASH = [
  "# 5harness bash completion",
  "_harness() {",
  '  local cur="${COMP_WORDS[COMP_CWORD]}"',
  '  local cmds="init link unlink projects intake story decision backlog query get search links doctor status next context dashboard mcp report peer project reindex upgrade completion"',
  '  COMPREPLY=( $(compgen -W "$cmds" -- "$cur") )',
  "}",
  "complete -F _harness harness 5harness 5hn",
  "",
].join("\n");

const ZSH = [
  "#compdef harness 5harness 5hn",
  "_arguments \"1:command:(init link unlink projects intake story decision backlog query get search links doctor status next context dashboard mcp report peer project reindex upgrade completion)\"",
  "",
].join("\n");

const PWSH = [
  "Register-ArgumentCompleter -Native -CommandName harness,5harness,5hn -ScriptBlock {",
  "  param($wordToComplete)",
  "  @('init','link','unlink','projects','intake','story','decision','backlog','query','get','search','links','doctor','status','next','context','dashboard','mcp','report','peer','project','reindex','upgrade','completion') |",
  '    Where-Object { $_ -like "$wordToComplete*" } |',
  "    ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }",
  "}",
  "",
].join("\n");

export function executeCompletion(shell: string): void {
  const s = shell.trim().toLowerCase();
  if (s === "bash") {
    console.log(BASH);
    return;
  }
  if (s === "zsh") {
    console.log(ZSH);
    return;
  }
  if (s === "pwsh" || s === "powershell") {
    console.log(PWSH);
    return;
  }
  throw new Error("Unknown shell. Use bash | zsh | pwsh");
}
