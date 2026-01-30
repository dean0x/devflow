# Git Safety - Sensitive File Detection

Patterns and functions for detecting sensitive files before commit.

---

## Sensitive File Patterns

### Credentials and Secrets

```bash
SENSITIVE_PATTERNS=(
  ".env"
  ".env.local"
  ".env.*.local"
  "*.key"
  "*.pem"
  "*.p12"
  "*.pfx"
  "*secret*"
  "*password*"
  "*credential*"
  "id_rsa"
  "id_dsa"
  "id_ed25519"
  "id_ecdsa"
  ".aws/credentials"
  ".npmrc"
  ".pypirc"
  ".netrc"
  ".pgpass"
  "*.keystore"
  "*.jks"
)
```

### Temporary and Generated Files

```bash
TEMP_PATTERNS=(
  "*.tmp"
  "*.temp"
  "*.log"
  "*.swp"
  "*.swo"
  "*~"
  ".DS_Store"
  "Thumbs.db"
  "*.bak"
  "*.orig"
  "*.rej"
  "*.pid"
  "*.seed"
  "*.cache"
)
```

### Build and Dependency Artifacts

```bash
ARTIFACT_PATTERNS=(
  "node_modules/"
  "vendor/"
  "dist/"
  "build/"
  "target/"
  "__pycache__/"
  "*.pyc"
  "*.pyo"
  ".next/"
  ".nuxt/"
  ".output/"
  "coverage/"
)
```

---

## Content Scanning Functions

### Full Secret Detection

```bash
# Check file content for secrets
check_for_secrets() {
    local file="$1"

    # API keys (various formats)
    if grep -qE 'api[_-]?key["\s]*[:=]["\s]*['\''"][a-zA-Z0-9_-]{20,}['\''"]' "$file" 2>/dev/null; then
        echo "WARNING: $file may contain API key"
        return 1
    fi

    # Passwords in config
    if grep -qE 'password["\s]*[:=]["\s]*['\''"][^'\''\"]{8,}['\''"]' "$file" 2>/dev/null; then
        echo "WARNING: $file may contain password"
        return 1
    fi

    # Private keys
    if grep -q 'BEGIN.*PRIVATE KEY' "$file" 2>/dev/null; then
        echo "BLOCK: $file contains private key"
        return 1
    fi

    # AWS credentials
    if grep -qE 'AKIA[0-9A-Z]{16}' "$file" 2>/dev/null; then
        echo "BLOCK: $file may contain AWS access key"
        return 1
    fi

    # AWS secret key pattern
    if grep -qE '[a-zA-Z0-9/+=]{40}' "$file" 2>/dev/null && grep -qi 'aws\|secret' "$file" 2>/dev/null; then
        echo "WARNING: $file may contain AWS secret key"
        return 1
    fi

    # GitHub tokens
    if grep -qE 'gh[pousr]_[A-Za-z0-9_]{36,}' "$file" 2>/dev/null; then
        echo "BLOCK: $file may contain GitHub token"
        return 1
    fi

    # Generic tokens
    if grep -qE 'token["\s]*[:=]["\s]*['\''"][a-zA-Z0-9_-]{32,}['\''"]' "$file" 2>/dev/null; then
        echo "WARNING: $file may contain token"
        return 1
    fi

    # Slack webhook URLs
    if grep -qE 'hooks\.slack\.com/services/[A-Z0-9]+/[A-Z0-9]+/[a-zA-Z0-9]+' "$file" 2>/dev/null; then
        echo "BLOCK: $file contains Slack webhook URL"
        return 1
    fi

    # Database connection strings with credentials
    if grep -qE '(mysql|postgres|mongodb)://[^:]+:[^@]+@' "$file" 2>/dev/null; then
        echo "WARNING: $file may contain database credentials"
        return 1
    fi

    return 0
}
```

### Batch File Checking

```bash
# Check all staged files for secrets
check_staged_files() {
    local has_secrets=0

    while IFS= read -r file; do
        if [[ -f "$file" ]]; then
            if ! check_for_secrets "$file"; then
                has_secrets=1
            fi
        fi
    done < <(git diff --cached --name-only)

    return $has_secrets
}
```

### Pre-commit Integration

```bash
# Run before committing
pre_commit_check() {
    echo "Checking for sensitive files..."

    # Check filenames
    local staged_files
    staged_files=$(git diff --cached --name-only)

    for pattern in "${SENSITIVE_PATTERNS[@]}"; do
        if echo "$staged_files" | grep -q "$pattern"; then
            echo "BLOCK: Staged file matches sensitive pattern: $pattern"
            return 1
        fi
    done

    # Check file contents
    if ! check_staged_files; then
        echo "BLOCK: Secrets detected in staged files"
        return 1
    fi

    echo "OK: No sensitive files detected"
    return 0
}
```

---

## Pattern Matching by File Type

### Environment Files

```bash
is_env_file() {
    local file="$1"
    case "$file" in
        .env|.env.*|*.env) return 0 ;;
        *) return 1 ;;
    esac
}
```

### Key Files

```bash
is_key_file() {
    local file="$1"
    case "$file" in
        *.key|*.pem|*.p12|*.pfx|*.jks|*.keystore) return 0 ;;
        id_rsa*|id_dsa*|id_ed25519*|id_ecdsa*) return 0 ;;
        *) return 1 ;;
    esac
}
```

### Config Files with Potential Secrets

```bash
should_scan_for_secrets() {
    local file="$1"
    case "$file" in
        *.json|*.yaml|*.yml|*.toml|*.ini|*.conf|*.config) return 0 ;;
        *.js|*.ts|*.py|*.rb|*.go|*.java) return 0 ;;
        *) return 1 ;;
    esac
}
```

---

## Gitignore Recommendations

Based on detected sensitive patterns, recommend `.gitignore` entries:

```bash
# Environment files
.env
.env.*
!.env.example

# Keys and certificates
*.key
*.pem
*.p12
*.pfx
*.jks
*.keystore

# SSH keys
id_rsa*
id_dsa*
id_ed25519*
id_ecdsa*

# Cloud credentials
.aws/credentials
.gcloud/
.azure/

# Package manager configs with tokens
.npmrc
.pypirc
.netrc

# Database files
*.sql
*.dump
*.sqlite
*.db

# Logs
*.log
logs/

# IDE and OS
.idea/
.vscode/
*.swp
*.swo
*~
.DS_Store
Thumbs.db
```
