import { signInWithPassword } from "../src/auth.js";
import { credentialsPath, saveRefreshToken } from "../src/credentials.js";

async function main(): Promise<void> {
  const email = process.env.CALIVERSE_EMAIL;
  const password = process.env.CALIVERSE_PASSWORD;
  if (email === undefined || password === undefined || email.length === 0 || password.length === 0) {
    throw new Error("Set CALIVERSE_EMAIL and CALIVERSE_PASSWORD for this one-time login. The password is never stored.");
  }

  const session = await signInWithPassword(email, password);
  await saveRefreshToken(session.refreshToken);
  process.stderr.write(`Caliverse refresh token securely saved to ${credentialsPath()}.\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown login error.";
  process.stderr.write(`Login failed: ${message}\n`);
  process.exitCode = 1;
});
