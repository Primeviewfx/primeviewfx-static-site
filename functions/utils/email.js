// Resend (https://resend.com) transactional email wrapper, plain fetch -
// no SDK dependency, consistent with the rest of this Functions layer.

export async function sendAccessLinkEmail(env, { to, redZonesUrl, greenZonesUrl, membersUrl, isWelcomeBack }) {
  const subject = isWelcomeBack
    ? "Your PrimeViewFX access is active again"
    : "Your PrimeViewFX indicator access";

  const bodyIntro = isWelcomeBack
    ? "Welcome back — your subscription is active again and your links below work as before."
    : "Thanks for subscribing. Here is your personal access.";

  const html = `<p>${bodyIntro}</p>
<p><a href="${membersUrl}">Open your members research page</a></p>
<p><a href="${redZonesUrl}">Download Red Zones</a><br><a href="${greenZonesUrl}">Download Green Zones</a></p>
<p>These links stay valid for as long as your subscription is active. Keep them private -
anyone with the link can use it while your subscription remains active.</p>
<p>Questions? Reply to this email.</p>`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: [to],
      subject,
      html,
    }),
  });

  if (!resp.ok) {
    throw new Error(`Resend send failed: ${resp.status} ${await resp.text()}`);
  }
}
