import { randomBytes } from "node:crypto"
console.log(randomBytes(30).toString("base64url").slice(0, 40))
