/* Appels aux IA depuis le navigateur : Claude, Gemini et OpenAI.
   Les clés restent sur l'appareil et sont envoyées directement à l'IA choisie. */
"use strict";

const FOURNISSEURS = {
  claude: {
    nom: "Claude",
    modeles: [
      ["claude-haiku-5-5", "Haiku 5.5 — le moins cher ($0,10 / $0,50)"],
      ["claude-sonnet-5-5", "Sonnet 5.5 — très bon ($2 / $10)"],
      ["claude-opus-5-5", "Opus 5.5 — meilleure qualité ($4 / $20)"],
    ],
    defaut: "claude-haiku-5-5",
    pageCle: "https://console.anthropic.com/settings/keys",
  },
  gemini: {
    nom: "Gemini",
    modeles: [
      ["gemini-3.8-flash", "3.8 Flash — rapide et bon marché ($0,75 / $3,75)"],
      ["gemini-3.1-flash-lite", "3.1 Flash-Lite — très économique ($0,25 / $1,50)"],
      ["gemini-3.1-pro-preview", "3.1 Pro — très bonne qualité ($2 / $12)"],
      ["gemini-4-argon", "4 Argon — le plus puissant, payant uniquement ($2 / $10)"],
    ],
    defaut: "gemini-3.8-flash",
    pageCle: "https://aistudio.google.com/apikey",
  },
  openai: {
    nom: "OpenAI",
    modeles: [
      ["gpt-6.1-sol", "GPT-6.1 Sol — équilibré ($2 / $10)"],
      ["gpt-6-luna", "GPT-6 Luna — le moins cher ($0,10 / $0,50)"],
      ["gpt-6-astra", "GPT-6 Astra — meilleure qualité ($10 / $50)"],
    ],
    defaut: "gpt-6.1-sol",
    pageCle: "https://platform.openai.com/api-keys",
  },
};

// Modèles Gemini proposés pour transcrire l'audio (prix de l'audio en entrée).
const MODELES_AUDIO = [
  ["gemini-3.1-flash-lite", "3.1 Flash-Lite — environ 0,11 € pour 2 h de cours"],
  ["gemini-3.8-flash", "3.8 Flash — plus précis, plus cher"],
];
const MODELE_AUDIO_DEFAUT = "gemini-3.1-flash-lite";

// Modèles Claude qui acceptent le repli automatique si un filtre de sécurité refuse un passage.
const CLAUDE_AVEC_REPLI = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

class ErreurIA extends Error {
  constructor(message, definitive = false) { super(message); this.definitive = definitive; }
}

async function appelHttp(url, options, delaiMs = 300000) {
  const controle = new AbortController();
  const minuteur = setTimeout(() => controle.abort(), delaiMs);
  let reponse;
  try {
    reponse = await fetch(url, { ...options, signal: controle.signal });
  } catch (e) {
    throw new ErreurIA(e.name === "AbortError" ? "l'IA a mis trop de temps à répondre."
      : "impossible de joindre l'IA (connexion internet ?).");
  } finally {
    clearTimeout(minuteur);
  }
  let donnees = null;
  try { donnees = await reponse.json(); } catch { /* réponse vide ou non JSON */ }
  if (!reponse.ok) {
    const detail = donnees?.error?.message || donnees?.error?.type || `erreur ${reponse.status}`;
    if (reponse.status === 401 || reponse.status === 403) throw new ErreurIA("clé API refusée : vérifie-la dans Paramètres.", true);
    if (reponse.status === 404) throw new ErreurIA(`modèle introuvable : vérifie son nom dans Paramètres (${detail}).`, true);
    if (reponse.status === 400) throw new ErreurIA(`demande refusée : ${detail}`, true);
    if (reponse.status === 429) throw new ErreurIA("limite de requêtes atteinte (quota gratuit épuisé ?).");
    throw new ErreurIA(detail);
  }
  return donnees;
}

// ---------------------------------------------------------------- Claude
async function appelClaude(modele, cle, consignes, contenu, approfondi) {
  const entetes = {
    "content-type": "application/json",
    "x-api-key": cle,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };
  const corps = {
    model: modele,
    max_tokens: 16000,
    system: consignes,
    messages: [{ role: "user", content: contenu }],
    // Effort « low » pendant le cours : moins de réflexion, donc moins de tokens facturés.
    output_config: { effort: approfondi ? "medium" : "low" },
  };
  if (CLAUDE_AVEC_REPLI.has(modele)) {
    entetes["anthropic-beta"] = "server-side-fallback-2026-07-01";
    corps.fallbacks = "default";
  }
  const d = await appelHttp("https://api.anthropic.com/v1/messages",
    { method: "POST", headers: entetes, body: JSON.stringify(corps) });
  if (d.stop_reason === "refusal") throw new ErreurIA("Claude a refusé ce passage (filtre de sécurité).");
  return (d.content || []).filter(b => b.type === "text").map(b => b.text).join("");
}

// ---------------------------------------------------------------- Gemini
function reglagesGemini(modele, niveau, maxSortie) {
  const config = { maxOutputTokens: maxSortie };
  // Les modèles Gemini 3 et plus réfléchissent avant de répondre : on limite cette réflexion.
  if (/^gemini-([3-9]|\d\d)/.test(modele)) config.thinkingConfig = { thinkingLevel: niveau };
  return config;
}

async function appelGemini(modele, cle, consignes, parties, niveau = "LOW", maxSortie = 16000) {
  const d = await appelHttp(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modele)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": cle },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: consignes }] },
        contents: [{ role: "user", parts: parties }],
        generationConfig: reglagesGemini(modele, niveau, maxSortie),
      }),
    });
  const candidat = d.candidates?.[0];
  if (!candidat && d.promptFeedback?.blockReason) {
    throw new ErreurIA(`Gemini a refusé ce passage (${d.promptFeedback.blockReason}).`);
  }
  return (candidat?.content?.parts || []).filter(p => p.text && !p.thought).map(p => p.text).join("");
}

// ---------------------------------------------------------------- OpenAI
async function appelOpenAI(modele, cle, consignes, contenu) {
  const d = await appelHttp("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cle}` },
    body: JSON.stringify({
      model: modele,
      messages: [{ role: "system", content: consignes }, { role: "user", content: contenu }],
    }),
  });
  return d.choices?.[0]?.message?.content || "";
}

// ---------------------------------------------------------------- Points d'entrée
async function avecEssais(fonction) {
  let derniere;
  for (let essai = 0; essai < 3; essai++) {
    try {
      return await fonction();
    } catch (e) {
      derniere = e;
      if (e.definitive) break;
      await new Promise(r => setTimeout(r, 8000 * (essai + 1)));
    }
  }
  throw derniere;
}

/** Fait rédiger un texte par l'IA choisie. approfondi = true pour les notes finales. */
async function rediger(fournisseur, modele, cle, consignes, contenu, approfondi = false) {
  if (!cle) throw new ErreurIA(`pas de clé API ${FOURNISSEURS[fournisseur].nom} (voir Paramètres).`, true);
  const texte = await avecEssais(() => {
    if (fournisseur === "claude") return appelClaude(modele, cle, consignes, contenu, approfondi);
    if (fournisseur === "gemini") return appelGemini(modele, cle, consignes, [{ text: contenu }],
      approfondi ? "MEDIUM" : "LOW");
    return appelOpenAI(modele, cle, consignes, contenu);
  });
  if (!texte.trim()) throw new ErreurIA("l'IA a renvoyé une réponse vide.");
  return texte.trim();
}

const CONSIGNES_TRANSCRIPTION = `Tu transcris l'audio d'un cours magistral universitaire en français.
Écris mot à mot ce que dit l'enseignant, avec la ponctuation, sans résumer ni commenter.
Transcris uniquement l'enseignant : la voix principale, la plus forte, souvent amplifiée par un micro.
Ignore les bavardages et chuchotements des étudiants proches, les bruits, la toux et les chaises.
Si une phrase de l'enseignant est couverte par le bruit, écris [inaudible] à sa place.
Si un étudiant pose une question à voix haute et que l'enseignant y répond, transcris-la précédée de « Question : ».
Si l'extrait ne contient aucune parole compréhensible, réponds exactement : [silence]`;

/** Transcrit un extrait audio WAV (base64) avec Gemini. */
async function transcrireAudio(modele, cle, wavBase64, contexte) {
  if (!cle) throw new ErreurIA("pas de clé API Gemini pour la transcription (voir Paramètres).", true);
  const texte = await avecEssais(() => appelGemini(modele, cle, CONSIGNES_TRANSCRIPTION, [
    { inlineData: { mimeType: "audio/wav", data: wavBase64 } },
    { text: contexte ? `Pour le contexte, la phrase précédente était : « ${contexte} ». Transcris cet extrait.`
                     : "Transcris cet extrait." },
  ], "LOW", 4000));
  const propre = texte.trim();
  return /^\[?silence\]?\.?$/i.test(propre) ? "" : propre;
}
