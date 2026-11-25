#!/bin/bash
# A read-only Claude Code agent on glm-5.3-flash:cloud (Ollama's Anthropic API) in a given checkout.
# Usage: agent-wt.sh <dir> <promptFile> <outFile> [timeoutSec]
cd "$1" || exit 2
ANTHROPIC_BASE_URL=http://127.0.0.1:11434 ANTHROPIC_AUTH_TOKEN=ollama ANTHROPIC_API_KEY= \
timeout "${4:-3600}" claude -p --model glm-5.3-flash:cloud --output-format text \
	--allowedTools "Read" "Grep" "Glob" "Bash(git diff:*)" "Bash(git log:*)" "Bash(git show:*)" "Bash(git status:*)" "Bash(gh issue view:*)" "Bash(gh pr view:*)" "Bash(gh pr diff:*)" \
	< "$2" > "$3" 2> "$3.err"
code=$?
echo "agent exit $code -> $3 ($(wc -c < "$3") bytes)"
exit $code
