#!/bin/bash
# A read-only Claude Code agent on glm-5.3-flash:cloud (Ollama's Anthropic API), in the SnapLinksPlus checkout.
# Usage: agent.sh <promptFile> <outFile> [timeoutSec]   The prompt is read from the file; stdout -> outFile, stderr -> outFile.err
cd /v/SnapLinksPlus || exit 2
ANTHROPIC_BASE_URL=http://127.0.0.1:11434 ANTHROPIC_AUTH_TOKEN=ollama ANTHROPIC_API_KEY= \
timeout "${3:-3600}" claude -p --model glm-5.3-flash:cloud --output-format text \
	--allowedTools "Read" "Grep" "Glob" "Bash(gh issue view:*)" "Bash(gh pr view:*)" "Bash(gh pr diff:*)" "Bash(gh search issues:*)" "Bash(gh search prs:*)" "Bash(git log:*)" "Bash(git show:*)" "Bash(git diff:*)" "Bash(git status:*)" \
	< "$1" > "$2" 2> "$2.err"
code=$?
echo "agent exit $code -> $2 ($(wc -c < "$2") bytes)"
exit $code
