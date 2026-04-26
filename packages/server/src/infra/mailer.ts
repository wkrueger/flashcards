import formData from "form-data"
import Mailgun from "mailgun.js"

type MailInput = {
  to: string
  subject: string
  html: string
  text: string
}

type MailgunClient = {
  messages: {
    create: (
      domain: string,
      data: { from: string; to: string; subject: string; text: string; html: string }
    ) => Promise<unknown>
  }
}

let cachedClient: MailgunClient | null = null

function getClient(): MailgunClient | null {
  if (cachedClient) return cachedClient
  const apiKey = process.env.MAILGUN_API_KEY
  const domain = process.env.MAILGUN_DOMAIN
  if (!apiKey || !domain) return null
  const region = (process.env.MAILGUN_REGION ?? "us").toLowerCase()
  const url = region === "eu" ? "https://api.eu.mailgun.net" : "https://api.mailgun.net"
  const mg = new Mailgun(formData)
  cachedClient = mg.client({ username: "api", key: apiKey, url }) as unknown as MailgunClient
  return cachedClient
}

export async function sendMail({ to, subject, html, text }: MailInput): Promise<void> {
  const client = getClient()
  const domain = process.env.MAILGUN_DOMAIN
  const from = process.env.MAILGUN_FROM ?? "Cards <no-reply@example.com>"

  if (!client || !domain) {
    console.info(
      `[mailer] Mailgun not configured — would send to ${to}\n  subject: ${subject}\n  ${text}`
    )
    return
  }

  await client.messages.create(domain, { from, to, subject, text, html })
}

const wrapHtml = (title: string, body: string) => `<!doctype html>
<html><body style="font-family: system-ui, sans-serif; max-width: 480px; margin: 32px auto; color: #111;">
  <h2 style="margin:0 0 16px">${title}</h2>
  ${body}
  <p style="margin-top:32px; font-size:12px; color:#666;">If you didn't request this, you can ignore this email.</p>
</body></html>`

export async function sendVerificationEmail(to: string, url: string): Promise<void> {
  const subject = "Verify your email"
  const text = `Welcome to Cards! Confirm your email by visiting:\n\n${url}\n\nThis link expires in 24 hours.`
  const html = wrapHtml(
    "Verify your email",
    `<p>Welcome to Cards! Confirm your email by clicking the link below.</p>
     <p><a href="${url}" style="display:inline-block;padding:10px 16px;background:#16a34a;color:#fff;text-decoration:none;border-radius:6px">Verify email</a></p>
     <p style="font-size:12px;color:#666">Or paste this URL into your browser: <br/>${url}</p>
     <p style="font-size:12px;color:#666">This link expires in 24 hours.</p>`
  )
  await sendMail({ to, subject, text, html })
}

export async function sendPasswordResetEmail(to: string, url: string): Promise<void> {
  const subject = "Reset your Cards password"
  const text = `Reset your password by visiting:\n\n${url}\n\nThis link expires in 1 hour.`
  const html = wrapHtml(
    "Reset your password",
    `<p>We received a request to reset your password.</p>
     <p><a href="${url}" style="display:inline-block;padding:10px 16px;background:#16a34a;color:#fff;text-decoration:none;border-radius:6px">Reset password</a></p>
     <p style="font-size:12px;color:#666">Or paste this URL into your browser: <br/>${url}</p>
     <p style="font-size:12px;color:#666">This link expires in 1 hour.</p>`
  )
  await sendMail({ to, subject, text, html })
}
