set dotenv-load := false

# List the available project commands.
default:
    @just --list

# Start LUMEN locally; pass another port with `just run 8080`.
run port="4173":
    PORT={{port}} npm start

# Run the unit test suite.
test:
    npm test

# Run tests and syntax-check every JavaScript module.
check: test
    node --check app.mjs
    node --check core.mjs
    node --check scripts/serve.mjs
