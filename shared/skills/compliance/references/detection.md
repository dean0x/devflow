# Detection Patterns

Grep patterns and IaC globs for automated compliance surface detection.

## PII / PHI Field Name Patterns

```bash
# Grep source files for common PII field names
grep -rn \
  -e '\bssn\b' -e '\bsocial_security\b' \
  -e '\bdob\b' -e '\bdate_of_birth\b' -e '\bbirth_date\b' \
  -e '\bcredit_card\b' -e '\bcard_number\b' -e '\bpan\b' \
  -e '\bcvv\b' -e '\bcvc\b' -e '\bcvv2\b' \
  -e '\btrack_data\b' -e '\btrack1\b' -e '\btrack2\b' \
  -e '\bpin_block\b' \
  -e '\bmedical_record\b' -e '\bmrn\b' -e '\bdiagnosis\b' \
  -e '\bnational_id\b' -e '\bpassport\b' \
  --include='*.ts' --include='*.js' --include='*.py' --include='*.go' \
  src/ lib/
```

## Logging Sinks Near PII

```bash
# Find logging calls that appear within 5 lines of PII field references
# Use: grep -A5 -B5 patterns near PII identifiers
grep -rn \
  -e 'console\.\(log\|error\|warn\)' \
  -e 'logger\.\(info\|error\|warn\|debug\)' \
  -e 'log\.\(info\|error\|warn\|debug\)' \
  --include='*.ts' --include='*.js' \
  src/ | grep -i 'email\|ssn\|password\|credit\|card\|cvv\|dob\|mrn'

# Python
grep -rn 'logging\.\|logger\.' --include='*.py' src/ | grep -i 'email\|ssn\|password\|credit'
```

## Crypto Misuse

```bash
# Weak or prohibited algorithms
grep -rn \
  -e '\bmd5\b' -e 'createHash.*md5' \
  -e '\bsha1\b' -e 'createHash.*sha1' \
  -e '\bdes\b' -e '\b3des\b' -e '\brc4\b' \
  -e 'Math\.random.*token\|Math\.random.*secret\|Math\.random.*key' \
  --include='*.ts' --include='*.js' --include='*.py' \
  src/

# Hardcoded secrets near crypto calls
grep -rn \
  -e 'AES.*["\x27][A-Za-z0-9+/=]\{16,\}["\x27]' \
  -e 'secret\s*=\s*["\x27][^"$\x27]\{8,\}["\x27]' \
  --include='*.ts' --include='*.js' \
  src/
```

## IaC Compliance Globs and Indicators

### Terraform (`**/*.tf`)

```bash
# Public storage exposure
grep -rn 'acl\s*=\s*"public' --include='*.tf' .
grep -rn 'publicly_accessible\s*=\s*true' --include='*.tf' .

# No encryption
grep -rn 'encrypted\s*=\s*false' --include='*.tf' .
grep -l 'aws_s3_bucket' --include='*.tf' -r . | \
  xargs grep -L 'server_side_encryption_configuration'

# Wildcard IAM
grep -rn '"Action"\s*:\s*"\*"\|"Resource"\s*:\s*"\*"' --include='*.tf' .

# Disabled access logging
grep -l 'aws_s3_bucket' --include='*.tf' -r . | xargs grep -L 'logging'
```

### Kubernetes (`**/k8s/**/*.yaml`, `**/kubernetes/**/*.yaml`)

```bash
grep -rn 'runAsRoot\|privileged:\s*true\|allowPrivilegeEscalation:\s*true' \
  --include='*.yaml' k8s/
# Missing securityContext is a finding if the workload handles regulated data
```

### Dockerfiles

```bash
# Secrets in ENV instructions
grep -rn '^ENV.*\(SECRET\|TOKEN\|PASSWORD\|KEY\|API_KEY\)' Dockerfile*
# Running as root
grep -rn '^USER root\|^RUN.*su -' Dockerfile*
```

### CI/CD (`.github/workflows/*.yml`)

```bash
grep -rn 'echo.*\(SECRET\|TOKEN\|PASSWORD\)' .github/workflows/
# Plaintext secrets echoed in run steps
grep -A3 'env:' .github/workflows/*.yml | grep -v '\${{' | grep -i 'secret\|token\|key'
```

## 0.0.0.0/0 Network Exposure

```bash
grep -rn '0\.0\.0\.0/0\|::/0' --include='*.tf' --include='*.yaml' --include='*.json' .
```
