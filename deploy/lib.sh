# shellcheck shell=bash
# Shared by the deploy scripts. Source it: . "$(dirname "$0")/lib.sh"

# Loads KEY=VALUE lines of a .env into the environment WITHOUT running it as shell code (a value
# like "<preencher>" or one with $, ;, spaces would break `. .env`). ${OTHER} inside a value is
# replaced by an earlier key of the same file, as docker compose does.
load_env() {
  local file="$1" line key value ref
  [[ -r "$file" ]] || { echo "não achei $file" >&2; return 1; }
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
    [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    while [[ "$value" =~ \$\{([A-Za-z_][A-Za-z0-9_]*)\} ]]; do
      ref="${BASH_REMATCH[1]}"
      value="${value//\$\{$ref\}/${!ref-}}"
    done
    export "$key=$value"
  done <"$file"
}
