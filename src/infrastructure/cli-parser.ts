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
  // Parse
  // ------------------------------------------------------------------

  /**
   * Parse an argv slice (e.g. process.argv). Populates internal state;
   * call opts() afterward to retrieve parsed option values.
   *
   * In US-056 this only does option/argument parsing — no action dispatch.
   * US-057 adds subcommand routing and action calls.
   */
  async parseAsync(argv: string[]): Promise<void> {
    const tokens = argv.slice(2); // skip node executable + script path
    this._parsedOpts = {};
    this._parsedArgs = [];

    // Seed defaults
    for (const opt of this._options) {
      if (opt.defaultValue !== undefined) {
        const key = opt.long ?? opt.short ?? "UNKNOWN";
        this._parsedOpts[key] = opt.takesValue
          ? opt.defaultValue
          : opt.defaultValue === "true";
      }
      // Negatable booleans: --flag defaults to false until --flag is seen
      if (!opt.takesValue && opt.long) {
        this._parsedOpts[opt.long] = false;
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
          this._parsedOpts[opt.long!] = false;
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
        this._parsedOpts[opt.long!] = opt.takesValue ? value : true;
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
          this._parsedOpts[opt.long!] = tokens[i];
        } else {
          this._parsedOpts[opt.long!] = true;
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
              this._parsedOpts[opt.long!] = shortChars.slice(ci + 1);
              break;
            }
            // value is next token
            i++;
            if (i >= tokens.length || tokens[i].startsWith("-")) {
              this._error(`option '-${ch}' requires a value`);
            }
            this._parsedOpts[opt.long!] = tokens[i];
          } else {
            this._parsedOpts[opt.long!] = true;
          }
        }
        i++;
        continue;
      }

      // Positional argument
      this._parsedArgs.push(token);
      i++;
    }

    // Validate required options
    for (const opt of this._options) {
      if (opt.required) {
        const key = opt.long ?? opt.short ?? "UNKNOWN";
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
      const valueMatch = part.match(/^(.+?)\s+[<\[](\w+)[\]>]$/);
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
