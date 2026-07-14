/**
 * Internal CLI parser — commander-compatible subset.
 *
 * US-056 (Part 1/3): Options, arguments, and help generation.
 * US-057 will add subcommand nesting, action dispatch, and hooks.
 * US-058 will integrate into cli.ts and remove the commander dependency.
 *
 * Implements the exact Commander API surface used in src/cli.ts:
 *   - name / description / version
 *   - option / requiredOption (short+long, value/boolean, defaults)
 *   - argument (<required> / [optional])
 *   - parseAsync (tokenizes argv, populates opts + positional args)
 *   - opts() returning parsed values
 *   - --help generation (subcommand-aware placeholder)
 *   - --version support
 *   - Error on unknown options
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OptionSpec {
  short: string | null;
  long: string | null;
  description: string;
  required: boolean;
  /** Whether the option consumes a value argument. Derived from the flags. */
  takesValue: boolean;
  defaultValue?: string;
  /** Whether this option was registered via version(). */
  isVersion: boolean;
}

export interface ArgumentSpec {
  name: string;
  required: boolean;
  description: string;
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export class Command {
  private _name = "";
  private _description = "";
  private _version = "";
  private _versionFlags = "-v, --version";
  private _versionDescription = "print CLI version";

  private _options: OptionSpec[] = [];
  private _args: ArgumentSpec[] = [];

  /** Populated after parseAsync(). */
  private _parsedOpts: Record<string, string | boolean> = {};
  /** Populated after parseAsync(). */
  private _parsedArgs: string[] = [];

  // US-057: subcommand nesting, action dispatch, hooks
  private _parent: Command | null = null;
  private _subcommands: Map<string, Command> = new Map();
  private _actionFn: ((...args: any[]) => void | Promise<void>) | null = null;
  private _hooks: Map<string, ((...args: any[]) => void | Promise<void>)[]> = new Map();

  /** The subcommand name that was matched during parse (set by the parent). */
  private _matchedName: string | null = null;


  // ------------------------------------------------------------------
  // Metadata
  // ------------------------------------------------------------------

  name(str: string): this {
    this._name = str;
    return this;
  }

  description(str: string): this {
    this._description = str;
    return this;
  }

  version(
    versionStr: string,
    flags?: string,
    description?: string,
  ): this {
    this._version = versionStr;
    if (flags !== undefined) this._versionFlags = flags;
    if (description !== undefined) this._versionDescription = description;
    return this;
  }

  // ------------------------------------------------------------------
  // Options
  // ------------------------------------------------------------------

  option(flags: string, description: string, defaultValue?: string): this {
    const parsed = this._parseFlags(flags);
    parsed.description = description;
    parsed.required = false;
    if (defaultValue !== undefined) {
      parsed.defaultValue = defaultValue;
    }
    this._options.push(parsed);
    return this;
  }

  requiredOption(flags: string, description: string): this {
    const parsed = this._parseFlags(flags);
    parsed.description = description;
    parsed.required = true;
    this._options.push(parsed);
    return this;
  }

  // ------------------------------------------------------------------
  // Positional arguments
  // ------------------------------------------------------------------

  /**
   * Register a positional argument.
   *
   *   "<name>"   required
   *   "[name]"   optional
   */
  argument(name: string, description: string): this {
    const required = name.startsWith("<") && name.endsWith(">");
    const cleanName = required
      ? name.slice(1, -1)
      : name.startsWith("[") && name.endsWith("]")
        ? name.slice(1, -1)
        : name;

    const spec: ArgumentSpec = {
      name: cleanName,
      required,
      description,
    };
    this._args.push(spec);
    return this;
  }

  // ------------------------------------------------------------------
  // Subcommands (US-057)
  // ------------------------------------------------------------------

  /**
   * Create a subcommand. Returns the child Command for chaining.
   * The child inherits nothing except the reference to its parent.
   */
  command(name: string): Command {
    const child = new Command();
    child._parent = this;
    child._matchedName = name;
    child.name(name);
    this._subcommands.set(name, child);
    return child;
  }

  // ------------------------------------------------------------------
  // Action dispatch (US-057)
  // ------------------------------------------------------------------

  /**
   * Register the action handler for this command.
   *
   * Arity detection (matching Commander):
   *   fn.length === 0  → call with no arguments
   *   fn.length === 1  → if positional args registered: pass first arg
   *                      if no positional args: pass opts object
   *   fn.length >= 2   → pass positional args (up to fn.length-1), then opts
   */
  action(fn: (...args: any[]) => void | Promise<void>): this {
    this._actionFn = fn;
    return this;
  }

  // ------------------------------------------------------------------
  // Hooks (US-057)
  // ------------------------------------------------------------------

  /**
   * Register a hook. Supported events: "preAction".
   * preAction hooks on parent commands fire before subcommand actions.
   */
  hook(event: string, fn: (...args: any[]) => void | Promise<void>): this {
    const list = this._hooks.get(event) ?? [];
    list.push(fn);
    this._hooks.set(event, list);
    return this;
  }

  // ------------------------------------------------------------------
  // Parse (extended for US-057)
  // ------------------------------------------------------------------

  /**
   * Parse an argv slice (e.g. process.argv). Populates internal state;
   * call opts() afterward to retrieve parsed option values.
   *
   * In US-056 this only does option/argument parsing — no action dispatch.
   * US-057 adds subcommand routing and action calls.
   */
  async parseAsync(argv: string[], _fromSubcommand = false): Promise<void> {
    const tokens = argv.slice(2); // skip node executable + script path
    this._parsedOpts = {};
    this._parsedArgs = [];

    // Seed defaults
    for (const opt of this._options) {
      if (opt.defaultValue !== undefined) {
        const key = this._optionKey(opt);
        this._parsedOpts[key] = opt.takesValue
          ? opt.defaultValue
          : opt.defaultValue === "true";
      }
      // Negatable booleans: --flag defaults to false until --flag is seen
      if (!opt.takesValue && opt.long) {
        this._parsedOpts[this._optionKey(opt)] = false;
      }
    }

    let i = 0;
    while (i < tokens.length) {
      const token = tokens[i];

      // --help
      if (token === "--help" || token === "-h") {
        this._printHelpAndExit();
      }

      // --version
      if (token === "--version" || (this._version && token === "-v")) {
        if (this._version) {
          this._printVersionAndExit();
        }
      }

      // Negated boolean: --no-xxx
      if (token.startsWith("--no-")) {
        const longName = token.slice(5);
        const opt = this._options.find(
          (o) => o.long === longName && !o.takesValue,
        );
        if (opt) {
          this._parsedOpts[this._optionKey(opt)] = false;
          i++;
          continue;
        }
        this._error(`unknown option '${token}'`);
      }

      // --long=value
      if (token.startsWith("--") && token.includes("=")) {
        const eqIdx = token.indexOf("=");
        const longName = token.slice(2, eqIdx);
        const value = token.slice(eqIdx + 1);
        const opt = this._options.find((o) => o.long === longName);
        if (!opt) {
          this._error(`unknown option '--${longName}'`);
        }
        this._parsedOpts[this._optionKey(opt)] = opt.takesValue ? value : true;
        i++;
        continue;
      }

      // --long (value may follow)
      if (token.startsWith("--")) {
        const longName = token.slice(2);
        const opt = this._options.find((o) => o.long === longName);
        if (!opt) {
          this._error(`unknown option '--${longName}'`);
        }
        if (opt.takesValue) {
          i++;
          if (i >= tokens.length || tokens[i].startsWith("-")) {
            this._error(`option '--${longName}' requires a value`);
          }
          this._parsedOpts[this._optionKey(opt)] = tokens[i];
        } else {
          this._parsedOpts[this._optionKey(opt)] = true;
        }
        i++;
        continue;
      }

      // -x (short flag, possibly combined or with inline value)
      if (token.startsWith("-") && token.length > 1) {
        const shortChars = token.slice(1);
        for (let ci = 0; ci < shortChars.length; ci++) {
          const ch = shortChars[ci];
          const opt = this._options.find((o) => o.short === ch);
          if (!opt) {
            this._error(`unknown option '-${ch}'`);
          }
          if (opt.takesValue) {
            if (ci + 1 < shortChars.length) {
              // rest of token is the value (e.g. -d./path)
              this._parsedOpts[this._optionKey(opt)] = shortChars.slice(ci + 1);
              break;
            }
            // value is next token
            i++;
            if (i >= tokens.length || tokens[i].startsWith("-")) {
              this._error(`option '-${ch}' requires a value`);
            }
            this._parsedOpts[this._optionKey(opt)] = tokens[i];
          } else {
            this._parsedOpts[this._optionKey(opt)] = true;
          }
        }
        i++;
        continue;
      }

      // Positional argument

      // US-057: subcommand routing — if token matches a subcommand, delegate
      if (this._subcommands.has(token)) {
        const child = this._subcommands.get(token)!;
        const rem = tokens.slice(i + 1);
        await child.parseAsync(["node", "cli", ...rem], true);
        return;
      }

      // US-057: unknown command at root with subcommands available
      if (this._subcommands.size > 0 && !this._actionFn && !_fromSubcommand) {
        const subNames = [...this._subcommands.keys()].join(", ");
        this._error(`unknown command '${token}'. Available: ${subNames}`);
      }

      this._parsedArgs.push(token);
      i++;
    }

    // Validate required options
    for (const opt of this._options) {
      if (opt.required) {
        const key = this._optionKey(opt);
        if (this._parsedOpts[key] === undefined) {
          this._error(`required option '--${opt.long}' not specified`);
        }
      }
    }

    // Validate required positional arguments
    for (let ai = 0; ai < this._args.length; ai++) {
      const argSpec = this._args[ai];
      if (argSpec.required && ai >= this._parsedArgs.length) {
        this._error(`missing required argument '${argSpec.name}'`);
      }
    }

    // US-057: run preAction hooks (root-first chain)
    await this._runPreActionHooks();

    // US-057: dispatch action if registered
    if (this._actionFn) {
      await this._dispatchAction();
    }
  }

  /**
   * Return parsed option values as a plain object.
   * Keys are the long option names (without leading --).
   */
  opts(): Record<string, string | boolean> {
    return { ...this._parsedOpts };
  }

  /**
   * Return parsed positional arguments.
   */
  get args(): string[] {
    return [...this._parsedArgs];
  }

  // ------------------------------------------------------------------
  // Hooks + dispatch helpers (US-057)
  // ------------------------------------------------------------------

  /**
   * Run preAction hooks from root to this command.
   */
  private async _runPreActionHooks(): Promise<void> {
    const chain: Command[] = [];
    let node: Command | null = this;
    while (node) {
      chain.unshift(node);
      node = node._parent;
    }
    for (const cmd of chain) {
      const hooks = cmd._hooks.get("preAction") ?? [];
      for (const fn of hooks) {
        await fn();
      }
    }
  }

  /**
   * Dispatch the stored action using arity-based argument mapping.
   */
  private async _dispatchAction(): Promise<void> {
    const fn = this._actionFn!;
    const arity = fn.length;
    if (arity === 0) {
      await fn();
      return;
    }
    if (arity === 1) {
      if (this._args.length > 0) {
        await fn(this._parsedArgs[0]);
      } else {
        await fn(this.opts());
      }
      return;
    }
    // arity >= 2: positional args (up to arity-1), then opts
    const args: unknown[] = [];
    for (let i = 0; i < Math.min(arity - 1, this._parsedArgs.length); i++) {
      args.push(this._parsedArgs[i]);
    }
    while (args.length < arity - 1) {
      args.push(undefined);
    }
    args.push(this.opts());
    await fn(...args);
  }

  // ------------------------------------------------------------------
  // Help
  // ------------------------------------------------------------------

  /**
   * Build the help text string.
   * Subcommand-aware placeholder — US-057 will extend for nested commands.
   */
  helpInformation(): string {
    const lines: string[] = [];

    // Usage line
    let usage = "Usage:";
    if (this._name) usage += ` ${this._name}`;
    if (this._options.length > 0) usage += " [options]";
    if (this._subcommands.size > 0) usage += " [command]";
    for (const arg of this._args) {
      usage += arg.required ? ` <${arg.name}>` : ` [${arg.name}]`;
    }
    lines.push(usage);

    // Description
    if (this._description) {
      lines.push("");
      lines.push(this._description);
    }

    // Arguments
    if (this._args.length > 0) {
      lines.push("");
      lines.push("Arguments:");
      for (const arg of this._args) {
        const label = arg.required ? `<${arg.name}>` : `[${arg.name}]`;
        lines.push(`  ${label.padEnd(20)} ${arg.description}`);
      }
    }

    // Options
    if (this._options.length > 0) {
      lines.push("");
      lines.push("Options:");
      for (const opt of this._options) {
        const flagLabel = this._optionFlagLabel(opt);
        lines.push(`  ${flagLabel.padEnd(22)} ${opt.description}`);
      }
    }

    // Subcommands (US-057)
    if (this._subcommands.size > 0) {
      lines.push("");
      lines.push("Commands:");
      for (const [name, child] of this._subcommands) {
        const desc = (child as Command)._description || "";
        lines.push(`  ${name.padEnd(24)} ${desc}`);
      }
    }

    // Version info
    if (this._version) {
      lines.push("");
      lines.push(`${this._versionFlags}  ${this._versionDescription} (${this._version})`);
    }

    // Help hint
    lines.push("");
    lines.push("-h, --help               display help for command");

    return lines.join("\n");
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  /**
   * Convert kebab-case to camelCase (commander-compatible).
   * "dry-run" → "dryRun", "max-chars" → "maxChars", "dir" → "dir"
   */
  private _camelCase(str: string): string {
    return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  }

  /**
   * Return the storage key for an option spec.
   * Long options are camelCased; short options are used as-is (fallback).
   */
  private _optionKey(opt: OptionSpec): string {
    if (opt.long) return this._camelCase(opt.long);
    return opt.short ?? "UNKNOWN";
  }

  private _parseFlags(flags: string): OptionSpec {
    const spec: OptionSpec = {
      short: null,
      long: null,
      description: "",
      required: false,
      takesValue: false,
      isVersion: false,
    };

    // Split on comma+optional-space: "-s, --long <val>" → ["-s", "--long <val>"]
    const parts = flags
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);

    for (const part of parts) {
      // Detect value marker: <xxx> or [xxx] at the end of this segment
      const valueMatch = part.match(/^(.+?)\s+[<\[]([^\]>]+)[\]>]$/);
      if (valueMatch) {
        spec.takesValue = true;
        const flagPart = valueMatch[1];
        if (flagPart.startsWith("--")) {
          spec.long = flagPart.slice(2);
        } else if (flagPart.startsWith("-") && flagPart.length === 2) {
          spec.short = flagPart.slice(1);
        }
      } else {
        // No value marker — boolean flag or bare short/long
        const trimmed = part;
        if (trimmed.startsWith("--")) {
          spec.long = trimmed.slice(2);
        } else if (trimmed.startsWith("-") && trimmed.length === 2) {
          spec.short = trimmed.slice(1);
        }
      }
    }

    return spec;
  }

  private _optionFlagLabel(opt: OptionSpec): string {
    const parts: string[] = [];
    if (opt.short) parts.push(`-${opt.short}`);
    if (opt.long) {
      let longLabel = `--${opt.long}`;
      if (opt.takesValue) longLabel += ` <value>`;
      parts.push(longLabel);
    }
    return parts.join(", ");
  }

  private _printHelpAndExit(): never {
    console.log(this.helpInformation());
    process.exit(0);
  }

  private _printVersionAndExit(): never {
    console.log(this._version);
    process.exit(0);
  }

  private _error(message: string): never {
    console.error(`error: ${message}`);
    process.exit(1);
  }
}
