// Detection heuristics shared by the input and policy guards. They are a tripwire, not the
// main defence: untrusted text only reaches prompts inside data blocks, and every business
// decision is made by code. A hit here routes the lead to a human.

/** Cyrillic letters that look like Latin ones, used to hide "ignore" as "іgnоrе". */
const HOMOGLYPHS: Record<string, string> = {
  а: 'a',
  с: 'c',
  е: 'e',
  і: 'i',
  о: 'o',
  р: 'p',
  х: 'x',
  у: 'y',
  к: 'k',
  м: 'm',
  т: 't',
  в: 'b',
  н: 'h',
};

/**
 * Lowercases, applies Unicode compatibility folding, joins s p a c e d letters and collapses
 * whitespace. Returns two variants: as written (for Ukrainian patterns) and with Cyrillic
 * look-alikes mapped to Latin inside Latin words (for English patterns).
 */
export function normalize(text: string): { native: string; latin: string } {
  const native = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/(?:^|\s)((?:\p{L}\s){3,}\p{L})(?=\s|$|[.,!?])/gu, (match, letters: string) =>
      match.replace(letters, letters.replace(/\s/g, '')),
    )
    .replace(/\s+/g, ' ')
    .trim();

  // Only rewrite words that mix scripts, so genuine Ukrainian text stays intact
  const latin = native.replace(/\p{L}+/gu, (word) =>
    /\p{Script=Latin}/u.test(word) && /\p{Script=Cyrillic}/u.test(word)
      ? [...word].map((ch) => HOMOGLYPHS[ch] ?? ch).join('')
      : word,
  );
  return { native, latin };
}

const INJECTION_EN: RegExp[] = [
  /\b(ignore|disregard|forget|override|bypass|skip)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|any|your|system|the|these)\b[^.\n]{0,20}\b(instructions?|prompts?|rules|directions|guidelines|guardrails)\b/,
  /\byou are now (a|an|in|my|the)\b|\bfrom now on,? you (are|will|must|should)\b/,
  /\bpretend (to be|you are|that you)\b|\bact as (a|an|the|if|my|our)\b|\brole-?play as\b/,
  /\b(reveal|print|show|repeat|output|tell me|display)\b[^.\n]{0,30}\b(system prompt|your prompt|your instructions|hidden instructions|initial instructions)\b/,
  /<\s*\/?\s*(system|assistant|instructions?|admin|developer)\s*>/,
  /(^|\n|\.\s)\s*(system|assistant|developer)\s*:/,
  /#{2,}\s*(instruction|system)|\[(system|inst)\]/,
  /\b(admin|developer|god|jailbreak|dan) mode\b/,
  /\b(lead_message|reply_context|matching_context)\b/,
  /\b(mark|set|score|rate|classify|flag)\b[^.\n]{0,30}\b(this lead|this request|me|us)\b[^.\n]{0,20}\b(hot|100|approved|top priority)\b/,
];

const INJECTION_UK: RegExp[] = [
  /(ігноруй|ігнорувати|забудь|не зважай на|відкинь)[^.\n]{0,40}(інструкц|правил|вказівк|промпт)/u,
  /(ти тепер|відтепер ти|уяви,? що ти|прикинься|вдавай,? що ти)/u,
  /(покажи|виведи|розкажи|повтори)[^.\n]{0,30}(системн\p{L}* промпт|сво\p{L}* інструкц|сві\p{L}* промпт)/u,
  /(познач|оціни|постав)[^.\n]{0,30}(цей лід|нас|мене)[^.\n]{0,20}(гарячий|100|пріоритет)/u,
];

/** Returns the matched fragments (empty when the text looks clean). */
export function findInjection(text: string): string[] {
  const { native, latin } = normalize(text);
  const hits = [
    ...INJECTION_EN.map((re) => re.exec(latin)?.[0]),
    ...INJECTION_UK.map((re) => re.exec(native)?.[0]),
  ];
  return [...new Set(hits.filter((h): h is string => Boolean(h)).map((h) => h.trim()))];
}

const SPAM_STRONG: RegExp[] = [
  /\b(we|i) (offer|provide|can help you with|specialize in) (seo|backlinks?|guest posts?|link building|web traffic|leads)\b/,
  /\b(rank|get) (your|you) (website|site|business) (on|to) (the )?(first|top|1st) (page|position)\b/,
  /\b(cheap|affordable|high quality|high da) (seo|backlinks?|guest posts?)\b/,
  /\b(casino|betting|sports bets?|crypto signals|forex signals|bitcoin investment|binary options|viagra|cialis|payday loans?|porn|xxx)\b/,
];

export type SpamCheck = { isSpam: boolean; reasons: string[] };

export function checkSpam(text: string): SpamCheck {
  const { latin } = normalize(text);
  const reasons: string[] = [];

  const strong = SPAM_STRONG.map((re) => re.exec(latin)?.[0]).find(Boolean);
  if (strong) reasons.push(`spam phrase "${strong}"`);

  const links = text.match(/https?:\/\/\S+/g)?.length ?? 0;
  if (links > 3) reasons.push(`${links} links`);

  // URLs are lowercase by convention and would hide a shouting message
  const letters = text.replace(/https?:\/\/\S+/g, '').match(/\p{L}/gu) ?? [];
  const upper = letters.filter((ch) => ch !== ch.toLowerCase()).length;
  if (letters.length >= 30 && upper / letters.length > 0.6) reasons.push('mostly capital letters');

  if (/(.)\1{9,}/u.test(text)) reasons.push('long repeated characters');

  // One strong signal is enough; weak signals (links, caps, repeats) need to stack up
  const weak = reasons.length - (strong ? 1 : 0);
  return { isSpam: Boolean(strong) || weak >= 2, reasons };
}
