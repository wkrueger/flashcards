import { sendMail, sendPasswordResetEmail, sendVerificationEmail } from "../src/infra/mailer.js"

type Kind = "plain" | "verify" | "reset"

function parseArgs() {
  const args = process.argv.slice(2)
  let to: string | undefined
  let kind: Kind = "plain"
  let url = "https://flashcard.wkrueger.space/example-link"

  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--to") to = args[++i]
    else if (a === "--kind") kind = args[++i] as Kind
    else if (a === "--url") url = args[++i]!
    else if (!to) to = a
  }
  return { to, kind, url }
}

async function main() {
  const { to, kind, url } = parseArgs()
  if (!to) {
    console.error(
      "Usage: pnpm --filter server send-test-email <recipient> [--kind plain|verify|reset] [--url <link>]"
    )
    process.exit(1)
  }

  console.info(`[send-test-email] kind=${kind} to=${to}`)
  if (kind === "verify") {
    await sendVerificationEmail(to, url)
  } else if (kind === "reset") {
    await sendPasswordResetEmail(to, url)
  } else {
    await sendMail({
      to,
      subject: "Cards test email",
      text: `This is a test email sent at ${new Date().toISOString()}.`,
      html: `<p>This is a <strong>test email</strong> sent at ${new Date().toISOString()}.</p>`,
    })
  }
  console.info("[send-test-email] done")
}

main().catch((err) => {
  console.error("[send-test-email] FAILED")
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>
    console.error("message:", e.message)
    console.error("status:", e.status)
    console.error("details:", e.details)
    console.error("type:", e.type)
    console.error("body:", e.body)
    console.error("full:", JSON.stringify(err, Object.getOwnPropertyNames(err), 2))
  } else {
    console.error(err)
  }
  process.exit(1)
})
