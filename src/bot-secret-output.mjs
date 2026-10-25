/** Run on complete native lines, before parsing or emitting any provider output. */
export function redactBoundBotSecret(value,secret){let text=String(value);if(!secret)return text;for(const form of new Set([secret,JSON.stringify(secret).slice(1,-1)]))text=text.split(form).join('[REDACTED]');return text;}
