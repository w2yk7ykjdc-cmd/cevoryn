import { config } from "dotenv";

// Integration tests run against a real Postgres/Redis (see README "Testing").
// Load the same .env used for local dev unless a dedicated .env.test exists.
config({ path: ".env.test" });
config({ path: ".env" });
