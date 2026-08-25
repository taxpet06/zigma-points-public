// IMPORTANT: This module MUST only be imported from Node.js-runtime contexts
// (tRPC mutations and the cron Route Handler). It transitively imports email.ts
// which uses nodemailer — NOT edge-compatible.

import { db } from "@/lib/db"
import { sendEmail } from "@/lib/email"
import { sendPushToUser } from "@/lib/push"

/** Returns the base app URL with any trailing slash stripped. */
function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")
}

/** Plain-text fallback for the HTML shell — improves deliverability. */
function emailText({
  heading,
  bodyText,
  url,
}: {
  heading: string
  bodyText: string
  url: string
}): string {
  return [heading, "", bodyText, "", url, "", "---", "Zigma Points — " + appUrl()].join("\n")
}

/**
 * Minimal, fully inline-styled HTML shell for notification emails.
 * Email clients strip <style> tags and external CSS — all styles must be inline.
 * Uses the hosted PNG logo (SVG does not render in most email clients).
 */
function emailShell({
  heading,
  bodyHtml,
  url,
}: {
  heading: string
  bodyHtml: string
  url: string
}): string {
  const base = appUrl()
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">
          <tr>
            <td style="padding:32px 32px 0 32px;text-align:center;">
              <img src="${base}/icon-192.png" width="64" height="64" alt="Zigma Points" style="display:block;margin:0 auto 16px auto;" />
              <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#18181b;">${heading}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 16px 32px;font-size:15px;color:#18181b;line-height:1.6;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 16px 32px;">
              <p style="font-size:13px;color:#71717a;word-break:break-all;margin:0 0 8px 0;">${url}</p>
              <a href="${url}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:600;">View</a>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 32px 32px;font-size:12px;color:#71717a;border-top:1px solid #f4f4f5;">
              You are receiving this email because you are a member of Zigma Points.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/**
 * Broadcasts a new-task notification to every registered user with an email.
 * Users with a null email are silently skipped.
 */
export async function notifyNewTask(
  taskId: string,
  taskTitle: string,
  zpReward: number | null,
): Promise<void> {
  const users = await db.user.findMany({
    where: { email: { not: null } },
    select: { id: true, email: true, name: true, emailNotifications: true },
  })

  const url = `${appUrl()}/tasks/${taskId}`
  const rewardLine =
    zpReward != null
      ? `Complete it to earn ${zpReward} ZP.`
      : "Complete it to earn ZP rewards."

  // ponytail: naive per-subscriber loop; broadcast to all shares the function's
  // maxDuration (Vercel Hobby, unset defaults) — batch/queue if subscriber count
  // grows into the hundreds
  await Promise.all(
    users
      .filter((u) => u.email !== null)
      .map((u) => {
        const bodyText = `Hi ${u.name ?? "there"}, a new activity has been posted: "${taskTitle}". ${rewardLine}`
        return Promise.all([
          u.emailNotifications
            ? sendEmail({
                to: u.email!,
                subject: `New task: ${taskTitle}`,
                html: emailShell({
                  heading: "New activity available",
                  bodyHtml: `<p>Hi ${u.name ?? "there"},</p><p>A new task has been posted: <strong>${taskTitle}</strong>. ${rewardLine}</p>`,
                  url,
                }),
                text: emailText({ heading: "New activity available", bodyText, url }),
              })
            : undefined,
          sendPushToUser(u.id, {
            title: "New activity available",
            body: `A new task has been posted: "${taskTitle}". ${rewardLine}`,
            url,
          }),
        ])
      }),
  )
}

/**
 * Notifies each tagged user when they are named in a new AWARD or DEDUCT post.
 * Users with a null email are silently skipped.
 */
export async function notifyTaggedInPost(
  targetUserIds: string[],
  postId: string,
): Promise<void> {
  // Dedupe ids to avoid double-sending if the caller didn't already
  const ids = [...new Set(targetUserIds)]
  if (ids.length === 0) return

  const users = await db.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, email: true, name: true, emailNotifications: true },
  })

  const url = `${appUrl()}/post/${postId}`

  await Promise.all(
    users
      .filter((u) => u.email !== null)
      .map((u) => {
        const bodyText = `Hi ${u.name ?? "there"}, someone has nominated you in a Zigma Points award or deduction post. Visit the post to see the details and vote counts.`
        return Promise.all([
          u.emailNotifications
            ? sendEmail({
                to: u.email!,
                subject: "You've been tagged in a Zigma Points post",
                html: emailShell({
                  heading: "You were tagged in a post",
                  bodyHtml: `<p>Hi ${u.name ?? "there"},</p><p>Someone has nominated you in a Zigma Points award or deduction post. Visit the post to see the details and vote counts.</p>`,
                  url,
                }),
                text: emailText({ heading: "You were tagged in a post", bodyText, url }),
              })
            : undefined,
          sendPushToUser(u.id, {
            title: "You were tagged in a post",
            body: "Someone has nominated you in a Zigma Points award or deduction post.",
            url,
          }),
        ])
      }),
  )
}

/**
 * Broadcasts a new-post notification to every registered user with an email
 * (including the author) whenever a user creates a post.
 * Users with a null email are silently skipped.
 *
 * `votable` is false for a REGULAR post, which has no vote to cast — the call to action
 * has to change with it, or the broadcast sends everyone to a post telling them to do
 * something the page does not offer.
 */
export async function notifyNewPost(
  postId: string,
  postTitle: string,
  authorId: string,
  votable = true,
): Promise<void> {
  const [users, author] = await Promise.all([
    db.user.findMany({
      where: { email: { not: null } },
      select: { id: true, email: true, name: true, emailNotifications: true },
    }),
    db.user.findUnique({
      where: { id: authorId },
      select: { name: true },
    }),
  ])

  const authorName = author?.name ?? "Someone"
  const url = `${appUrl()}/post/${postId}`

  // ponytail: naive per-subscriber loop; broadcast to all shares the function's
  // maxDuration (Vercel Hobby, unset defaults) — batch/queue if subscriber count
  // grows into the hundreds
  await Promise.all(
    users
      .filter((u) => u.email !== null)
      .map((u) => {
        const cta = votable ? "go vote" : "take a look"
        const bodyText = `Hi ${u.name ?? "there"}, ${authorName} just posted "${postTitle}" — ${cta}.`
        return Promise.all([
          u.emailNotifications
            ? sendEmail({
                to: u.email!,
                subject: `New post: ${postTitle}`,
                html: emailShell({
                  heading: "New post on Zigma Points",
                  bodyHtml: `<p>Hi ${u.name ?? "there"},</p><p>${authorName} just posted <strong>${postTitle}</strong> — ${cta}.</p>`,
                  url,
                }),
                text: emailText({ heading: "New post on Zigma Points", bodyText, url }),
              })
            : undefined,
          sendPushToUser(u.id, {
            title: `New post: ${postTitle}`,
            body: `${authorName} just posted "${postTitle}" — ${cta}.`,
            url,
          }),
        ])
      }),
  )
}

/**
 * Notifies the party who has to answer a PENDING transfer. Both directions need an
 * approval, so both get the same nudge, worded for what they're being asked:
 *   kind "request" — someone wants THEIR ZP (they are the payer)
 *   kind "send"    — someone wants to send them ZP, possibly as a loan with interest
 * Users with a null email are silently skipped.
 */
export async function notifyTransferRequest(
  approverId: string,
  otherName: string,
  amount: number,
  kind: "request" | "send" = "request",
): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: approverId },
    select: { id: true, email: true, name: true, emailNotifications: true },
  })
  if (!user || user.email === null) return

  const url = `${appUrl()}/`
  const heading = kind === "send" ? "Incoming ZP transfer" : "New ZP request"
  const headline =
    kind === "send"
      ? `${otherName} wants to send you ${amount} ZP`
      : `${otherName} requested ${amount} ZP from you`
  const headlineHtml =
    kind === "send"
      ? `<strong>${otherName}</strong> wants to send you <strong>${amount} ZP</strong>`
      : `<strong>${otherName}</strong> requested <strong>${amount} ZP</strong> from you`

  const bodyText = `Hi ${user.name ?? "there"}, ${headline}. Open the Exchange tab to approve or reject it.`
  if (user.emailNotifications) {
    await sendEmail({
      to: user.email,
      subject: headline,
      html: emailShell({
        heading,
        bodyHtml: `<p>Hi ${user.name ?? "there"},</p><p>${headlineHtml}. Open the Exchange tab to approve or reject it.</p>`,
        url,
      }),
      text: emailText({ heading, bodyText, url }),
    })
  }

  await sendPushToUser(user.id, { title: heading, body: `${headline}.`, url })
}

/**
 * Notifies the recipient of a new PENDING trade offer — they owe an answer (approve/reject
 * in the Exchange tab's Pending list). Mirrors notifyTransferRequest's shape exactly.
 * Users with a null email are silently skipped.
 */
export async function notifyTradeOffer(
  recipientId: string,
  offererName: string,
  itemName: string,
  price: number,
): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: recipientId },
    select: { id: true, email: true, name: true, emailNotifications: true },
  })
  if (!user || user.email === null) return

  const url = `${appUrl()}/`
  const heading = "New trade offer"
  const headline = `${offererName} wants to sell you ${itemName} for ${price} ZP`
  const headlineHtml = `<strong>${offererName}</strong> wants to sell you <strong>${itemName}</strong> for <strong>${price} ZP</strong>`

  const bodyText = `Hi ${user.name ?? "there"}, ${headline}. Open the Exchange tab's Pending list to approve or reject it.`
  if (user.emailNotifications) {
    await sendEmail({
      to: user.email,
      subject: headline,
      html: emailShell({
        heading,
        bodyHtml: `<p>Hi ${user.name ?? "there"},</p><p>${headlineHtml}. Open the Exchange tab's Pending list to approve or reject it.</p>`,
        url,
      }),
      text: emailText({ heading, bodyText, url }),
    })
  }

  await sendPushToUser(user.id, { title: heading, body: `${headline}.`, url })
}

/**
 * Notifies the seller when their listing sells. Mirrors notifyTransferRequest's shape exactly.
 * Users with a null email are silently skipped.
 */
export async function notifyListingSold(
  sellerId: string,
  buyerName: string,
  itemName: string,
  price: number,
): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: sellerId },
    select: { id: true, email: true, name: true, emailNotifications: true },
  })
  if (!user || user.email === null) return

  const url = `${appUrl()}/`
  const heading = "Your listing sold"
  const headline = `${buyerName} bought your ${itemName} for ${price} ZP`
  const headlineHtml = `<strong>${buyerName}</strong> bought your <strong>${itemName}</strong> for <strong>${price} ZP</strong>`

  const bodyText = `Hi ${user.name ?? "there"}, ${headline}. The ZP is already in your balance.`
  if (user.emailNotifications) {
    await sendEmail({
      to: user.email,
      subject: headline,
      html: emailShell({
        heading,
        bodyHtml: `<p>Hi ${user.name ?? "there"},</p><p>${headlineHtml}. The ZP is already in your balance.</p>`,
        url,
      }),
      text: emailText({ heading, bodyText, url }),
    })
  }

  await sendPushToUser(user.id, { title: heading, body: `${headline}.`, url })
}

/**
 * Broadcasts a "games have reset" push to every user at the midnight rollover — both
 * the daily spin and the Wordle word reset at the same time (America/New_York).
 * Push-only by design — a daily email would be spam. Users with no push subscription
 * are simply never reached (sendPushToUser is a no-op for them).
 */
export async function notifyDailyRewardReady(): Promise<void> {
  const users = await db.user.findMany({ select: { id: true } })
  const url = `${appUrl()}/game-hub`

  // ponytail: naive per-user push loop; fine at MVP scale. Batch/queue if the user
  // count grows into the hundreds and the cron nears the function timeout.
  await Promise.all(
    users.map((u) =>
      sendPushToUser(u.id, {
        title: "🎮 The games have reset",
        body: "New Wordle and a fresh daily spin are live — tap to play for ZP.",
        url,
      }),
    ),
  )
}

/**
 * Tells a user that a LEADERBOARD paid them, naming the board, the place, and the ZP —
 * "you came 2nd in Petris, +12 ZP" is worth a push in a way the generic notifyZpChange
 * ("your balance changed") isn't. Covers both boards that pay ZP:
 *   board "daily"    — the reset cron's payout to yesterday's top 3
 *   board "all-time" — taking sole #1 all-time, credited the moment the run ends
 * Push-only: a leaderboard email every morning would be spam.
 */
export async function notifyLeaderboardPrize(
  userId: string,
  game: string,
  rank: number,
  zp: number,
  board: "daily" | "all-time" = "daily",
): Promise<void> {
  const medal = board === "all-time" ? "👑" : (["🥇", "🥈", "🥉"][rank - 1] ?? "🏆")
  const place = ["1st", "2nd", "3rd"][rank - 1] ?? `${rank}th`
  const title =
    board === "all-time"
      ? `${medal} ${place} all-time in ${game}`
      : `${medal} ${place} place in ${game}`
  const body =
    board === "all-time"
      ? `You took ${place} on the ${game} all-time leaderboard — +${zp} ZP.`
      : `You finished ${place} on yesterday's ${game} leaderboard — +${zp} ZP. Defend your spot today!`
  await sendPushToUser(userId, { title, body, url: `${appUrl()}/game-hub` })
}

/**
 * Notifies a user that their Zigma Point balance has changed.
 * Users with a null email are silently skipped.
 */
export async function notifyZpChange(userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, username: true, emailNotifications: true },
  })

  if (!user || user.email === null) return

  const url = user.username ? `${appUrl()}/u/${user.username}` : `${appUrl()}/`

  const bodyText = `Hi ${user.name ?? "there"}, check your Zigma Point Balance — your account has been updated. Visit your profile to see your current balance and recent activity.`
  if (user.emailNotifications) {
    await sendEmail({
      to: user.email,
      subject: "Your Zigma Points balance has been updated",
      html: emailShell({
        heading: "Your ZP balance changed",
        bodyHtml: `<p>Hi ${user.name ?? "there"},</p><p>Check your Zigma Point Balance — your account has been updated. Visit your profile to see your current balance and recent activity.</p>`,
        url,
      }),
      text: emailText({ heading: "Your ZP balance changed", bodyText, url }),
    })
  }

  await sendPushToUser(user.id, {
    title: "Your ZP balance changed",
    body: `Hi ${user.name ?? "there"}, your Zigma Points balance was updated.`,
    url,
  })
}
