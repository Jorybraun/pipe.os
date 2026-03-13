#!/bin/bash

# Pipe Demo Setup Validator & Launcher
# Usage: bash scripts/demo-setup.sh [start|validate|reset]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_ROOT/.env.local"
DEMO_EMAIL="demo@pipe.test"
DEMO_PASSWORD="DemoPass123!"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_header() {
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}  PIPE — Demo Setup${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

print_success() {
  echo -e "${GREEN}✅  $1${NC}"
}

print_error() {
  echo -e "${RED}❌  $1${NC}"
}

print_warning() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

print_info() {
  echo -e "${BLUE}ℹ️  $1${NC}"
}

validate_setup() {
  print_header
  
  local all_good=true

  # Check Node.js
  if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    print_success "Node.js found: $NODE_VERSION"
  else
    print_error "Node.js not found. Install from https://nodejs.org/"
    all_good=false
  fi

  # Check npm
  if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm -v)
    print_success "npm found: $NPM_VERSION"
  else
    print_error "npm not found."
    all_good=false
  fi

  # Check node_modules
  if [ -d "$PROJECT_ROOT/node_modules" ]; then
    print_success "node_modules directory exists"
  else
    print_warning "node_modules not found. Run: npm install"
    all_good=false
  fi

  # Check .env.local
  if [ -f "$ENV_FILE" ]; then
    print_success ".env.local exists"
    if grep -q "VITE_DEMO_EMAIL" "$ENV_FILE"; then
      print_success "Demo credentials configured in .env.local"
    else
      print_warning ".env.local is missing VITE_DEMO_EMAIL"
    fi
  else
    print_warning ".env.local not found. Creating with demo credentials..."
    cat > "$ENV_FILE" << EOF
# Demo Credentials for Local Development
VITE_DEMO_EMAIL=$DEMO_EMAIL
VITE_DEMO_PASSWORD=$DEMO_PASSWORD
E2E_EMAIL=$DEMO_EMAIL
E2E_PASSWORD=$DEMO_PASSWORD
VITE_AMPLIFY_DEBUG=false
EOF
    print_success ".env.local created with demo credentials"
  fi

  # Check ampx
  if command -v ampx &> /dev/null; then
    print_success "AWS Amplify CLI (ampx) found"
  else
    print_warning "AWS Amplify CLI (ampx) not found. Install via: npm install -g @aws-amplify/cli"
  fi

  # Check amplify_outputs.json
  if [ -f "$PROJECT_ROOT/amplify_outputs.json" ]; then
    print_success "amplify_outputs.json exists"
  else
    print_warning "amplify_outputs.json not found. Run 'npx ampx sandbox' to generate."
  fi

  # Check git hooks
  if [ -f "$PROJECT_ROOT/.git/hooks/pre-commit" ]; then
    print_success "Git pre-commit hook installed"
  else
    print_warning "Git hooks not installed. Run: bash scripts/install-hooks.sh"
  fi

  echo ""
  if [ "$all_good" = true ]; then
    print_success "All checks passed! ✨"
    echo ""
    print_info "Next: Run 'bash scripts/demo-setup.sh start' to launch the demo"
  else
    print_warning "Some checks failed. Please review above."
    echo ""
    print_info "Setup steps:"
    echo "  1. npm install"
    echo "  2. bash scripts/install-hooks.sh"
    echo "  3. npx ampx sandbox  (in Terminal 1)"
    echo "  4. npm run dev       (in Terminal 2)"
  fi
}

start_demo() {
  print_header
  
  print_info "Demo Setup Instructions"
  echo ""
  
  # Validate first
  if ! validate_setup > /dev/null 2>&1; then
    print_warning "Some setup checks failed. Running validation..."
    validate_setup
    return 1
  fi

  echo ""
  print_info "Start the demo in two terminals:"
  echo ""
  echo -e "${YELLOW}Terminal 1:${NC} Start Amplify Sandbox"
  echo "  $ npx ampx sandbox"
  echo ""
  echo -e "${YELLOW}Terminal 2:${NC} Start Vite Dev Server"
  echo "  $ npm run dev"
  echo ""
  echo -e "${GREEN}Then open:${NC} http://localhost:5173"
  echo ""
  echo -e "${GREEN}Demo Credentials:${NC}"
  echo "  Email:    $DEMO_EMAIL"
  echo "  Password: $DEMO_PASSWORD"
  echo ""
  print_info "Or create a new account with your own email during signup."
  echo ""
  print_info "See DEMO_LOGIN_SETUP.md for detailed instructions."
}

reset_sandbox() {
  print_header
  
  print_warning "Resetting Amplify Sandbox..."
  
  if [ -d "$PROJECT_ROOT/.amplify/local/" ]; then
    rm -rf "$PROJECT_ROOT/.amplify/local/"
    print_success "Sandbox data cleared"
  else
    print_info "No local sandbox data to clear"
  fi

  print_info "Next time you run 'npx ampx sandbox', a fresh sandbox will be created."
}

print_help() {
  cat << EOF
Pipe Demo Setup Helper

Usage: bash scripts/demo-setup.sh [COMMAND]

Commands:
  start      Show startup instructions and validate setup
  validate   Validate all dependencies and config
  reset      Clear local Amplify sandbox data
  help       Show this message

Examples:
  bash scripts/demo-setup.sh validate
  bash scripts/demo-setup.sh start
  bash scripts/demo-setup.sh reset

For full documentation, see: DEMO_LOGIN_SETUP.md
EOF
}

# Main
COMMAND="${1:-start}"

case "$COMMAND" in
  start)
    start_demo
    ;;
  validate)
    validate_setup
    ;;
  reset)
    reset_sandbox
    ;;
  help)
    print_help
    ;;
  *)
    print_error "Unknown command: $COMMAND"
    echo ""
    print_help
    exit 1
    ;;
esac
