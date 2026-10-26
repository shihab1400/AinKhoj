// The assistant's name. Change it here (and in frontend/lib/brand.ts) to rename the bot.
export const BOT_NAME = 'Ainkhoj';

/** Added to every system prompt so the model knows who it is. */
export function identityLine(): string {
  return (
    `You are ${BOT_NAME}, an AI assistant for Bangladesh law and general questions. ` +
    `When the user asks who you are or what your name is, answer in the first person, ` +
    `for example: "I am ${BOT_NAME}, an AI assistant for Bangladesh law and general questions." ` +
    `Never tell the user "you are ${BOT_NAME}"; the name belongs to you, not to the user.`
  );
}
