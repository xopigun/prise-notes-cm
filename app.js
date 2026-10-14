/* Prise de notes CM — version web (iPad, Mac, PC, Android). */
"use strict";

const $ = sel => document.querySelector(sel);
const ECHANTILLONNAGE = 16000;   // 16 kHz mono, comme Whisper
const MORCEAU_S = 30;            // durée des extraits envoyés à Gemini
const MARGE_COUPE_S = 5;         // on coupe sur un silence dans les 5 dernières secondes

const MODES = { complet: "Complet", eco: "Économique", fin: "Fin de cours" };

const CONSIGNES_NOTES = `Tu prends des notes pour un étudiant pendant un cours magistral universitaire. \
Tu reçois la transcription automatique de ce que dit l'enseignant (elle peut contenir des erreurs de \
reconnaissance vocale).

Rédige des notes de cours claires, en français, au format Markdown :
- un titre « # » avec le sujet du cours, puis le plan du cours avec des « ## » et « ### » ;
- des phrases courtes et des listes à puces, pas de recopie mot à mot ;
- les définitions en **gras**, les formules en LaTeX ($...$), les exemples sous « *Exemple :* » ;
- marque avec ⚠️ tout ce que l'enseignant présente comme important
  (« à retenir », « c'est fondamental », « ça tombera à l'examen », répétitions...) ;
- termine par une section « ## Infos pratiques » (dates, partiels, devoirs, lectures,
  consignes) si l'enseignant en a donné, et « ## Points à vérifier » pour les
  passages inaudibles ou douteux de la transcription.

Corrige les erreurs évidentes de transcription (mots mal reconnus, termes techniques)
mais n'invente rien qui n'a pas été dit.
La transcription peut aussi contenir des bavardages d'étudiants, des questions inaudibles ou des phrases sans rapport avec le cours : ignore-les.
Réponds uniquement avec les notes en Markdown.`;

const CONSIGNE_SUITE = `Rédige UNIQUEMENT les notes de cette nouvelle partie du cours : elles seront \
ajoutées à la suite des notes existantes. Continue le plan existant (nouveau titre « ## » ou « ### » \
seulement si l'enseignant passe à une nouvelle partie) et ne répète rien de ce qui est déjà noté. \
N'ajoute pas les sections « Infos pratiques » et « Points à vérifier » : signale plutôt une info \
pratique par une ligne commençant par « 📌 ». Elles seront regroupées à la fin du cours.`;

// ================================================================ Réglages (enregistrés sur l'appareil)
const REGLAGES_DEFAUT = {
  transcription: "appareil", modeleAudio: MODELE_AUDIO_DEFAUT,
  fournisseur: "claude", modeles: {}, cles: {},
  theme: "system", mode: "eco", intervalle: 5, avecIa: true,
};

function lire(cle, defaut) {
  try { return JSON.parse(localStorage.getItem(cle)) ?? defaut; } catch { return defaut; }
}
function ecrire(cle, valeur) {
  try { localStorage.setItem(cle, JSON.stringify(valeur)); return true; } catch { return false; }
}

let reglages = { ...REGLAGES_DEFAUT, ...lire("pncm-reglages", {}) };
const sauverReglages = () => ecrire("pncm-reglages", reglages);
const modeleIa = (f = reglages.fournisseur) => reglages.modeles[f] || FOURNISSEURS[f].defaut;
const descriptionModele = (f, m) => (FOURNISSEURS[f].modeles.find(([id]) => id === m) || [m, m])[1];
const nomIa = () => `${FOURNISSEURS[reglages.fournisseur].nom} · ${descriptionModele(reglages.fournisseur, modeleIa()).split(" — ")[0]}`;

function appliquerTheme() {
  if (reglages.theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = reglages.theme;
}

// ================================================================ Cours enregistrés
const lireCours = () => lire("pncm-cours", []);
function sauverCours(cours) {
  const liste = lireCours().filter(c => c.id !== cours.id);
  liste.unshift(cours);
  if (!ecrire("pncm-cours", liste)) {
    statut("⚠️ Mémoire du navigateur pleine : exporte puis supprime d'anciens cours (Tous mes cours).");
  }
}

// ================================================================ Utilitaires
function horodatage(secondes) {
  const s = Math.max(0, Math.floor(secondes));
  return [Math.floor(s / 3600), Math.floor(s % 3600 / 60), s % 60].map(n => String(n).padStart(2, "0")).join(":");
}
const statut = texte => { $("#statut").textContent = texte; };
function bandeau(texte) {
  const b = $("#bandeau");
  b.hidden = !texte;
  b.textContent = texte || "";
}
function segments(conteneur, valeur, auChangement) {
  const boutons = [...conteneur.querySelectorAll("button")];
  const choisir = v => boutons.forEach(b => b.classList.toggle("actif", b.dataset.valeur === v));
  boutons.forEach(b => { b.onclick = () => { choisir(b.dataset.valeur); auChangement?.(b.dataset.valeur); }; });
  choisir(valeur);
  return () => boutons.find(b => b.classList.contains("actif"))?.dataset.valeur;
}

// ================================================================ Transcription : dictée de l'appareil
class DicteeAppareil {
  constructor({ surTexte, surProvisoire, surErreur }) {
    this.surTexte = surTexte; this.surProvisoire = surProvisoire; this.surErreur = surErreur;
    this.actif = false; this.enPause = false;
  }

  static disponible() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition) && !DicteeAppareil.navigateurSansService(); }

  /** Navigateurs qui annoncent la dictée mais ne fournissent pas le service (Opera, Brave, Vivaldi…). */
  static navigateurSansService() {
    const ua = navigator.userAgent;
    if (/OPR\/|Opera|OPX\/|Vivaldi|YaBrowser|DuckDuckGo/.test(ua) || navigator.brave) {
      return "ce navigateur (Opera, Brave, Vivaldi…) ne fournit pas la dictée";
    }
    if (/Firefox\//.test(ua)) return "Firefox ne propose pas la dictée";
    return "";
  }

  static messageErreur(code) {
    return {
      "network": "la dictée du navigateur ne répond pas (service indisponible ou pas d'internet). "
        + "Utilise Chrome, Edge ou Safari, ou choisis « Gemini » dans Paramètres.",
      "audio-capture": "la dictée n'arrive pas à utiliser le micro : vérifie qu'il est branché et autorisé.",
      "not-allowed": "accès au micro ou à la dictée refusé. Sur iPad : Réglages → Safari → Micro → Autoriser, "
        + "et Réglages → Général → Clavier → Dictée. Sur ordinateur : autorise le micro pour ce site.",
      "service-not-allowed": "la dictée est bloquée par ce navigateur. Utilise Chrome, Edge ou Safari, "
        + "ou choisis « Gemini » dans Paramètres.",
      "language-not-supported": "la dictée de ce navigateur ne gère pas le français. Choisis « Gemini » dans Paramètres.",
    }[code];
  }

  async demarrer() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) throw new Error("ce navigateur ne propose pas la dictée. Choisis « Gemini » dans Paramètres.");
    const sansService = DicteeAppareil.navigateurSansService();
    if (sansService) throw new Error(`${sansService}. Utilise Chrome, Edge ou Safari, ou choisis « Gemini » dans Paramètres.`);
    this.actif = true;
    this.echecsDeSuite = 0;
    this._lancer(SR);
  }

  _lancer(SR) {
    const r = new SR();
    r.lang = "fr-FR";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = e => {
      let provisoire = "";
      this.echecsDeSuite = 0;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const texte = e.results[i][0].transcript.trim();
        if (e.results[i].isFinal) { if (texte) this.surTexte(texte); }
        else provisoire += texte + " ";
      }
      this.surProvisoire(provisoire.trim());
    };
    r.onerror = e => {
      // « no-speech » (silence) et « aborted » (arrêt normal) ne sont pas des pannes.
      if (e.error === "no-speech" || e.error === "aborted") return;
      this.echecsDeSuite++;
      const definitive = ["not-allowed", "service-not-allowed", "language-not-supported"].includes(e.error);
      // Une erreur réseau isolée peut arriver ; au bout de 3 de suite, la dictée ne marche pas ici.
      if (definitive || this.echecsDeSuite >= 3) {
        this.actif = false;
        this.surErreur(DicteeAppareil.messageErreur(e.error) || `la dictée s'est arrêtée (erreur « ${e.error} »).`, true);
      }
    };
    // La dictée s'arrête toute seule après un silence ou au bout d'une minute : on la relance.
    r.onend = () => {
      this.surProvisoire("");
      if (this.actif && !this.enPause) setTimeout(() => this.actif && !this.enPause && this._lancer(SR), 250);
    };
    this.reconnaissance = r;
    try { r.start(); } catch { /* déjà démarrée */ }
  }

  pause() { this.enPause = true; this.reconnaissance?.stop(); }
  reprendre() {
    this.enPause = false;
    this._lancer(window.SpeechRecognition || window.webkitSpeechRecognition);
  }
  relancerSiBesoin() { if (this.actif && !this.enPause) this.reprendre(); }
  async arreter() { this.actif = false; this.reconnaissance?.stop(); }
}

// ================================================================ Transcription : audio envoyé à Gemini
class TranscriptionGemini {
  constructor({ surTexte, surErreur, surEtat }) {
    this.surTexte = surTexte; this.surErreur = surErreur; this.surEtat = surEtat;
    this.morceaux = []; this.taille = 0; this.secondesEnvoyees = 0;
    this.enPause = false; this.file = Promise.resolve(); this.enAttente = 0;
    this.derniereFrase = "";
  }

  async demarrer() {
    const cle = reglages.cles.gemini;
    if (!cle) throw new Error("ajoute une clé API Gemini dans Paramètres pour la transcription.");
    // Le contexte audio doit être créé pendant l'appui sur le bouton (exigence d'iOS).
    try { this.ctx = new AudioContext({ sampleRate: ECHANTILLONNAGE }); }
    catch { this.ctx = new AudioContext(); }
    this.flux = await ouvrirMicro({ channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true });
    await this.ctx.resume();
    const source = this.ctx.createMediaStreamSource(this.flux);
    this.processeur = this.ctx.createScriptProcessor(4096, 1, 1);
    this.processeur.onaudioprocess = e => {
      if (this.enPause) return;
      const bloc = this._reechantillonner(e.inputBuffer.getChannelData(0));
      this.morceaux.push(bloc);
      this.taille += bloc.length;
      if (this.taille >= MORCEAU_S * ECHANTILLONNAGE) this._envoyer(false);
    };
    source.connect(this.processeur);
    this.processeur.connect(this.ctx.destination);
  }

  _reechantillonner(entree) {
    const rapport = this.ctx.sampleRate / ECHANTILLONNAGE;
    if (rapport === 1) return new Float32Array(entree);
    const sortie = new Float32Array(Math.floor(entree.length / rapport));
    for (let i = 0; i < sortie.length; i++) {
      const p = i * rapport, j = Math.floor(p), f = p - j;
      sortie[i] = entree[j] * (1 - f) + (entree[j + 1] ?? entree[j]) * f;
    }
    return sortie;
  }

  _envoyer(tout) {
    const audio = new Float32Array(this.taille);
    let p = 0;
    for (const m of this.morceaux) { audio.set(m, p); p += m.length; }
    const coupe = tout ? audio.length : this._pointDeCoupe(audio);
    const extrait = audio.subarray(0, coupe);
    const reste = audio.slice(coupe);
    this.morceaux = reste.length ? [reste] : [];
    this.taille = reste.length;
    if (extrait.length < ECHANTILLONNAGE / 2) return;
    const debut = this.secondesEnvoyees;
    this.secondesEnvoyees += extrait.length / ECHANTILLONNAGE;
    const wav = encoderWav(extrait);
    this.enAttente++;
    this.surEtat?.(this.enAttente);
    // Les extraits sont transcrits un par un, dans l'ordre.
    this.file = this.file.then(async () => {
      try {
        const texte = await transcrireAudio(reglages.modeleAudio || MODELE_AUDIO_DEFAUT, reglages.cles.gemini,
          wav, this.derniereFrase);
        if (texte) { this.derniereFrase = texte.slice(-200); this.surTexte(texte, debut); }
      } catch (e) {
        this.surErreur(`transcription d'un passage impossible : ${e.message}`);
        this.surTexte("[passage non transcrit]", debut);
      } finally {
        this.enAttente--;
        this.surEtat?.(this.enAttente);
      }
    });
  }

  // Coupe au moment le plus silencieux des dernières secondes, pour ne pas couper un mot.
  _pointDeCoupe(audio) {
    const trame = ECHANTILLONNAGE / 10;
    const debut = Math.max(0, audio.length - MARGE_COUPE_S * ECHANTILLONNAGE);
    let meilleur = audio.length, minimum = Infinity;
    for (let i = debut; i + trame <= audio.length; i += trame) {
      let energie = 0;
      for (let j = i; j < i + trame; j++) energie += audio[j] * audio[j];
      if (energie < minimum) { minimum = energie; meilleur = i + trame / 2; }
    }
    return meilleur;
  }

  pause() { this.enPause = true; }
  reprendre() { this.enPause = false; this.ctx?.resume(); }
  relancerSiBesoin() { this.ctx?.resume(); }

  async arreter() {
    this.processeur?.disconnect();
    this.flux?.getTracks().forEach(t => t.stop());
    this._envoyer(true);
    await this.file;
    await this.ctx?.close();
  }
}

/** Ouvre le micro choisi dans Paramètres (ou celui par défaut s'il n'est plus branché). */
async function ouvrirMicro(options = {}) {
  if (reglages.micro) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { ...options, deviceId: { exact: reglages.micro } } });
    } catch (e) {
      if (e.name !== "OverconstrainedError" && e.name !== "NotFoundError") throw e;
      statut("⚠️ Le micro choisi n'est plus branché : micro par défaut utilisé.");
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio: options });
}

/** Écoute 6 secondes avec la dictée du navigateur et affiche ce qu'elle a compris. */
async function testerDictee(zone) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const sansService = DicteeAppareil.navigateurSansService();
  if (!SR || sansService) {
    zone.className = "petit ko";
    zone.textContent = `✗ Dictée : ${sansService || "ce navigateur ne la propose pas"}. Utilise Chrome, Edge ou Safari, `
      + "ou choisis « Gemini » ci-dessus.";
    return false;
  }
  zone.className = "petit ko";
  zone.textContent = "🎙 Test de la dictée : dis une phrase maintenant…";
  let texte = "", erreur = "";
  await new Promise(fini => {
    const rec = new SR();
    rec.lang = "fr-FR";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = e => {
      texte = [...e.results].map(x => x[0].transcript).join(" ").trim();
      zone.className = "petit doux";
      zone.textContent = `🎙 « ${texte} »`;
    };
    rec.onerror = e => { if (e.error !== "no-speech" && e.error !== "aborted") erreur = e.error; };
    rec.onend = fini;
    try { rec.start(); } catch { fini(); }
    setTimeout(() => { try { rec.stop(); } catch { fini(); } }, 6000);
    setTimeout(fini, 9000);
  });
  if (texte) {
    zone.className = "petit ok";
    zone.textContent = `✓ La dictée fonctionne : « ${texte.slice(0, 120)} »`;
    return true;
  }
  zone.className = "petit ko";
  zone.textContent = "✗ Dictée : " + (DicteeAppareil.messageErreur(erreur)
    || (erreur ? `erreur « ${erreur} ».` : "elle n'a rien compris. Parle plus fort ou choisis « Gemini » ci-dessus."));
  return false;
}

function niveauSonore(analyseur, tampon) {
  analyseur.getFloatTimeDomainData(tampon);
  let somme = 0;
  for (const v of tampon) somme += v * v;
  const rms = Math.sqrt(somme / tampon.length);
  return Math.min(1, Math.max(0, (20 * Math.log10(rms + 1e-9) + 60) / 60));
}

function encoderWav(echantillons) {
  const tampon = new ArrayBuffer(44 + echantillons.length * 2);
  const v = new DataView(tampon);
  const ecrireTexte = (pos, t) => { for (let i = 0; i < t.length; i++) v.setUint8(pos + i, t.charCodeAt(i)); };
  ecrireTexte(0, "RIFF"); v.setUint32(4, 36 + echantillons.length * 2, true); ecrireTexte(8, "WAVE");
  ecrireTexte(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, ECHANTILLONNAGE, true); v.setUint32(28, ECHANTILLONNAGE * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ecrireTexte(36, "data"); v.setUint32(40, echantillons.length * 2, true);
  for (let i = 0; i < echantillons.length; i++) {
    const s = Math.max(-1, Math.min(1, echantillons[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  // Conversion en base64 par paquets (une seule chaîne géante ferait planter Safari).
  const octets = new Uint8Array(tampon);
  let binaire = "";
  for (let i = 0; i < octets.length; i += 0x8000) binaire += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  return btoa(binaire);
}

// ================================================================ Un cours en train d'être enregistré
class Seance {
  constructor(titre, options) {
    this.cours = {
      id: Date.now().toString(36), titre, debut: new Date().toISOString(),
      segments: [], notes: "", termine: false, ia: options.avecIa ? nomIa() : "",
    };
    this.options = options;           // { avecIa, mode, intervalle }
    this.dejaResumes = 0;
    this.redactionEnCours = null;
    this.chrono = { depart: 0, cumul: 0 };
  }

  secondes() {
    const { depart, cumul } = this.chrono;
    return cumul + (depart ? (Date.now() - depart) / 1000 : 0);
  }

  async demarrer() {
    const rappels = {
      surTexte: (texte, debut) => this.ajouter(texte, debut ?? this.secondes()),
      surProvisoire: texte => interface_.provisoire(texte),
      surErreur: (message, bloquante) => {
        statut(`⚠️ ${message}`);
        if (bloquante) bandeau(`⚠️ La transcription s'est arrêtée : ${message}`);
      },
      surEtat: n => interface_.etiquetteTranscription(n),
    };
    this.transcripteur = reglages.transcription === "gemini"
      ? new TranscriptionGemini(rappels) : new DicteeAppareil(rappels);
    await this.transcripteur.demarrer();
    this.chrono.depart = Date.now();
    if (this.options.avecIa && this.options.mode !== "fin") {
      this.minuteur = setInterval(() => this.mettreAJourNotes(), this.options.intervalle * 60000);
    }
    sauverCours(this.cours);
  }

  ajouter(texte, debut) {
    this.cours.segments.push({ t: debut, texte });
    interface_.ajouterTranscription(debut, texte);
    sauverCours(this.cours);
  }

  pause() {
    this.chrono.cumul = this.secondes();
    this.chrono.depart = 0;
    this.transcripteur.pause();
  }
  reprendre() {
    this.chrono.depart = Date.now();
    this.transcripteur.reprendre();
  }
  get enPause() { return !this.chrono.depart; }

  transcription(depuis = 0) {
    return this.cours.segments.slice(depuis).map(s => `[${horodatage(s.t)}] ${s.texte}`).join("\n");
  }

  async mettreAJourNotes() {
    if (this.redactionEnCours) return;
    const fin = this.cours.segments.length;
    if (fin <= this.dejaResumes) return;
    const extrait = this.transcription(this.dejaResumes);
    this.redactionEnCours = (async () => {
      statut(`Mise à jour des notes (${nomIa()})…`);
      try {
        const titre = this.cours.titre;
        let notes;
        if (this.options.mode === "eco" && this.cours.notes) {
          const plan = this.cours.notes.split("\n").filter(l => l.startsWith("#")).join("\n");
          const suite = await this._rediger(`Cours : ${titre}\n\n<plan_des_notes>\n${plan}\n</plan_des_notes>\n\n`
            + `<fin_des_notes>\n${this.cours.notes.slice(-1500)}\n</fin_des_notes>\n\n`
            + `<suite_de_la_transcription>\n${extrait}\n</suite_de_la_transcription>\n\n${CONSIGNE_SUITE}`);
          notes = `${this.cours.notes.trimEnd()}\n\n${suite}`;
        } else {
          notes = await this._rediger(`Cours : ${titre}\n\n<notes_actuelles>\n${this.cours.notes || "(aucune pour l'instant)"}\n`
            + `</notes_actuelles>\n\n<suite_de_la_transcription>\n${extrait}\n</suite_de_la_transcription>\n\n`
            + "Renvoie les notes complètes mises à jour avec cette suite du cours.");
        }
        this.cours.notes = notes;
        this.dejaResumes = fin;
        interface_.afficherNotes(notes);
        sauverCours(this.cours);
        statut("Notes mises à jour.");
      } catch (e) {
        statut(`⚠️ Notes : ${e.message} Nouvel essai à la prochaine mise à jour.`);
      }
    })();
    await this.redactionEnCours;
    this.redactionEnCours = null;
  }

  _rediger(contenu, approfondi = false) {
    return rediger(reglages.fournisseur, modeleIa(), reglages.cles[reglages.fournisseur],
      CONSIGNES_NOTES, contenu, approfondi);
  }

  async terminer() {
    clearInterval(this.minuteur);
    this.chrono.cumul = this.secondes();
    this.chrono.depart = 0;
    statut("Fin de la transcription…");
    await this.transcripteur.arreter();
    await this.redactionEnCours;
    if (this.options.avecIa && this.cours.segments.length) {
      statut(`Rédaction de la version finale des notes (${nomIa()})…`);
      try {
        this.cours.notes = await this._rediger(`Cours : ${this.cours.titre}\n\n<transcription_complete>\n`
          + `${this.transcription()}\n</transcription_complete>\n\nRédige les notes complètes de ce cours.`, true);
        interface_.afficherNotes(this.cours.notes);
        statut("Notes finales prêtes : « Ouvrir dans Word » pour les récupérer.");
      } catch (e) {
        statut(`⚠️ Notes finales : ${e.message} Les dernières notes sont conservées ; tu peux aussi `
          + "utiliser « Copier pour l'abonnement ».");
      }
    } else {
      statut(this.cours.segments.length ? "Cours terminé." : "Cours terminé : aucune parole détectée.");
    }
    this.cours.termine = true;
    this.cours.duree = this.secondes();
    sauverCours(this.cours);
  }
}

function texteAbonnement(cours) {
  const transcription = cours.segments.map(s => `[${horodatage(s.t)}] ${s.texte}`).join("\n");
  return `${CONSIGNES_NOTES}\n\nCours : ${cours.titre}\n\n<transcription_complete>\n${transcription}\n`
    + "</transcription_complete>\n\nRédige les notes complètes de ce cours.";
}

// ================================================================ Interface
let seance = null;        // cours en cours d'enregistrement
let coursAffiche = null;  // cours affiché (en cours ou rouvert depuis « Mes cours »)
let verrouEcran = null;
let cacheLe = 0;

const interface_ = {
  ajouterTranscription(debut, texte) {
    const zone = $("#zone-texte");
    zone.querySelector(".vide")?.remove();
    const enBas = zone.scrollHeight - zone.scrollTop - zone.clientHeight < 60;
    const p = document.createElement("p");
    p.innerHTML = `<span class="heure">${horodatage(debut)}</span>`;
    p.append(texte);
    const provisoire = zone.querySelector(".provisoire");
    if (provisoire) provisoire.before(p); else zone.append(p);
    if (enBas) zone.scrollTop = zone.scrollHeight;
    $("#bouton-copier").disabled = false;
    $("#bouton-plus").disabled = false;
  },
  provisoire(texte) {
    const zone = $("#zone-texte");
    let p = zone.querySelector(".provisoire");
    if (!texte) { p?.remove(); return; }
    zone.querySelector(".vide")?.remove();
    if (!p) { p = document.createElement("p"); p.className = "provisoire"; zone.append(p); }
    p.textContent = texte;
    zone.scrollTop = zone.scrollHeight;
  },
  afficherNotes(md) {
    $("#zone-notes").innerHTML = md ? markdownVersHtml(md)
      : '<p class="vide">Les notes structurées apparaîtront ici après quelques minutes de cours.</p>';
    $("#bouton-word").disabled = !md;
  },
  etiquetteTranscription(enAttente) {
    const base = reglages.transcription === "gemini" ? "ce que dit l'enseignant · Gemini" : "ce que dit l'enseignant";
    $("#etiquette-transcription").textContent = enAttente ? `${base} · ${enAttente} en cours…` : base;
  },
};

function afficherCours(cours) {
  coursAffiche = cours;
  $("#titre-cours").textContent = cours.titre;
  $("#date-jour").textContent = dateLisible(new Date(cours.debut));
  const zone = $("#zone-texte");
  zone.innerHTML = cours.segments.length ? "" : '<p class="vide">La transcription apparaîtra ici dès le début du cours.</p>';
  cours.segments.forEach(s => interface_.ajouterTranscription(s.t, s.texte));
  interface_.afficherNotes(cours.notes);
  $("#etiquette-ia").textContent = cours.ia || (cours === seance?.cours || cours.segments.length
    ? "notes IA désactivées" : nomIa());
  const vide = !cours.segments.length;
  $("#bouton-copier").disabled = vide;
  $("#bouton-plus").disabled = vide && !cours.notes;
}

function dateLisible(d) {
  const t = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function voyant(texte, classe = "") {
  const v = $("#voyant");
  v.textContent = texte;
  v.className = `voyant ${classe}`;
}

function activerReglages(actif) {
  ["#titre", "#avec-ia", "#intervalle"].forEach(s => { $(s).disabled = !actif; });
  $("#choix-mode").classList.toggle("desactive", !actif);
  $("#bouton-start").disabled = !actif;
}

async function demanderVerrouEcran() {
  try { verrouEcran = await navigator.wakeLock?.request("screen"); } catch { verrouEcran = null; }
}

async function demarrer() {
  const titre = $("#titre").value.trim();
  if (!titre) {
    $("#titre").classList.add("erreur");
    $("#titre").focus();
    statut("Donne d'abord un nom au cours (ex. « Droit civil — séance 3 »).");
    return;
  }
  $("#titre").classList.remove("erreur");
  const avecIa = $("#avec-ia").checked;
  if (avecIa && !reglages.cles[reglages.fournisseur]) {
    if (confirm(`Aucune clé API ${FOURNISSEURS[reglages.fournisseur].nom} : seule la transcription sera faite `
      + "(tu pourras quand même copier le cours pour ton abonnement).\n\nOuvrir les paramètres ?")) {
      ouvrirParametres();
      return;
    }
  }
  reglages.mode = lireMode();
  reglages.intervalle = Number($("#intervalle").value);
  reglages.avecIa = avecIa;
  sauverReglages();

  const nouvelle = new Seance(titre, {
    avecIa: avecIa && !!reglages.cles[reglages.fournisseur], mode: reglages.mode, intervalle: reglages.intervalle,
  });
  activerReglages(false);
  $("#bouton-start").textContent = "Préparation…";
  voyant("● Préparation…", "pause");
  bandeau("");
  afficherCours(nouvelle.cours);
  $("#bouton-copier").disabled = true;
  $("#bouton-plus").disabled = true;
  interface_.etiquetteTranscription(0);
  try {
    await nouvelle.demarrer();
  } catch (e) {
    statut(`Impossible de démarrer : ${e.message}`);
    voyant("● Prêt");
    $("#bouton-start").textContent = "●\u00a0\u00a0 Démarrer";
    activerReglages(true);
    return;
  }
  seance = nouvelle;
  demanderVerrouEcran();
  $("#bouton-start").textContent = "●\u00a0\u00a0 Enregistrement";
  $("#bouton-pause").disabled = false;
  $("#bouton-fin").disabled = false;
  statut("Enregistrement en cours. Garde cette page ouverte et l'écran allumé pendant le cours.");
}

function pause() {
  if (!seance) return;
  if (seance.enPause) {
    seance.reprendre();
    $("#bouton-pause").textContent = "❚❚\u00a0 Pause";
    statut("Enregistrement en cours.");
  } else {
    seance.pause();
    $("#bouton-pause").textContent = "▶\u00a0 Reprendre";
    voyant("❚❚ En pause", "pause");
    statut("En pause.");
  }
}

async function terminer() {
  if (!seance || !confirm("Terminer le cours et rédiger les notes finales ?")) return;
  $("#bouton-pause").disabled = true;
  $("#bouton-fin").disabled = true;
  voyant("● Finalisation des notes…", "pause");
  const s = seance;
  await s.terminer();
  seance = null;
  verrouEcran?.release().catch(() => {});
  verrouEcran = null;
  voyant("✓ Cours terminé", "fini");
  $("#bouton-start").textContent = "●\u00a0\u00a0 Démarrer";
  $("#bouton-pause").textContent = "❚❚\u00a0 Pause";
  $("#chrono").textContent = horodatage(s.cours.duree);
  activerReglages(true);
  afficherCours(s.cours);
}

let lireMode = () => reglages.mode;

function boucle() {
  if (seance) {
    $("#chrono").textContent = horodatage(seance.secondes());
    if (!seance.enPause) {
      const v = $("#voyant");
      if (!v.classList.contains("rec")) voyant("● Enregistrement en cours", "rec");
      v.classList.toggle("clignote", Math.floor(Date.now() / 700) % 2 === 1);
    }
  }
}

// iPadOS coupe le micro quand l'écran se verrouille ou qu'on change d'appli : on prévient.
document.addEventListener("visibilitychange", () => {
  if (!seance) return;
  if (document.hidden) {
    cacheLe = Date.now();
  } else {
    const absence = Math.round((Date.now() - cacheLe) / 1000);
    seance.transcripteur.relancerSiBesoin();
    demanderVerrouEcran();
    if (cacheLe && absence > 5) {
      bandeau(`⚠️ La page n'était plus affichée pendant ${absence < 120 ? `${absence} s` : `${Math.round(absence / 60)} min`} : `
        + "ce passage du cours n'a sans doute pas été enregistré. Garde la page ouverte et l'écran allumé.");
    }
    cacheLe = 0;
  }
});

window.addEventListener("beforeunload", e => {
  if (seance) { e.preventDefault(); e.returnValue = ""; }
});

// ================================================================ Exports
async function exporter(type) {
  const cours = coursAffiche;
  if (!cours) return;
  try {
    if (type === "docx") {
      if (!cours.notes) { statut("Pas encore de notes à exporter."); return; }
      statut("Création du document Word…");
      const blob = await markdownVersDocx(cours.notes, cours.titre);
      const r = await enregistrerFichier(blob, nomFichier(`Notes - ${cours.titre}`, "docx"));
      statut(r === "partage" ? "Document partagé." : r === "annule" ? "Partage annulé." : "Document Word téléchargé.");
    } else if (type === "md") {
      await enregistrerFichier(new Blob([cours.notes || ""], { type: "text/markdown" }), nomFichier(`Notes - ${cours.titre}`, "md"));
    } else if (type === "transcription") {
      const texte = cours.segments.map(s => `[${horodatage(s.t)}] ${s.texte}`).join("\n");
      await enregistrerFichier(new Blob([texte], { type: "text/plain" }), nomFichier(`Transcription - ${cours.titre}`, "txt"));
    } else if (type === "copier-notes") {
      await navigator.clipboard.writeText(cours.notes || "");
      statut("Notes copiées.");
    }
  } catch (e) {
    statut(`⚠️ Export impossible : ${e.message}`);
  }
}

async function copierPourAbonnement() {
  if (!coursAffiche) return;
  try {
    await navigator.clipboard.writeText(texteAbonnement(coursAffiche));
    statut("Cours copié ! Colle-le dans l'appli Gemini, Claude ou ChatGPT : les notes seront rédigées "
      + "avec ton abonnement, sans clé API.");
  } catch {
    statut("⚠️ Copie impossible : ton navigateur l'a refusée.");
  }
}

// ================================================================ Mes cours
function ouvrirMesCours() {
  const liste = $("#liste-cours");
  liste.innerHTML = "";
  const cours = lireCours();
  if (!cours.length) liste.innerHTML = '<li class="doux">Aucun cours enregistré pour l\'instant.</li>';
  for (const c of cours) {
    const li = document.createElement("li");
    const infos = document.createElement("div");
    infos.className = "infos";
    infos.innerHTML = `<div></div><div class="doux petit"></div>`;
    infos.firstChild.textContent = c.titre;
    infos.lastChild.textContent = `${dateLisible(new Date(c.debut))} · ${c.duree ? horodatage(c.duree) : "inachevé"}`
      + (c.notes ? " · notes" : "");
    const boutons = document.createElement("div");
    boutons.className = "boutons";
    const ouvrir = Object.assign(document.createElement("button"), { type: "button", className: "bouton bouton-bleu petit-bouton", textContent: "Ouvrir" });
    const supprimer = Object.assign(document.createElement("button"), { type: "button", className: "bouton bouton-secondaire petit-bouton", textContent: "Supprimer" });
    ouvrir.disabled = seance?.cours.id === c.id;
    ouvrir.onclick = () => {
      if (seance) { statut("Termine d'abord le cours en cours d'enregistrement."); return; }
      afficherCours(c);
      $("#chrono").textContent = horodatage(c.duree || 0);
      voyant(c.termine ? "✓ Cours terminé" : "● Cours inachevé", c.termine ? "fini" : "pause");
      $("#fen-cours").close();
      statut("Cours rouvert : tu peux l'exporter ou le copier pour ton abonnement.");
    };
    supprimer.disabled = seance?.cours.id === c.id;
    supprimer.onclick = () => {
      if (!confirm(`Supprimer « ${c.titre} » de cet appareil ?`)) return;
      ecrire("pncm-cours", lireCours().filter(x => x.id !== c.id));
      li.remove();
    };
    boutons.append(ouvrir, supprimer);
    li.append(infos, boutons);
    liste.append(li);
  }
  $("#fen-cours").showModal();
}

// ================================================================ Paramètres
function ouvrirParametres() {
  const fen = $("#fen-param");
  const brouillon = JSON.parse(JSON.stringify(reglages));
  const champCle = $("#champ-cle");

  // IA des notes : modèle et clé de l'IA choisie (on garde les saisies de chaque IA)
  const choixIa = $("#choix-ia");
  choixIa.innerHTML = Object.entries(FOURNISSEURS).map(([id, f]) => `<button type="button" data-valeur="${id}">${f.nom}</button>`).join("");
  function memoriser() {
    const f = brouillon.fournisseur;
    brouillon.modeles[f] = $("#modele-ia").value.trim();
    brouillon.cles[f] = champCle.value.trim();
  }
  function afficherIa() {
    const f = brouillon.fournisseur;
    $("#liste-modeles-ia").innerHTML = FOURNISSEURS[f].modeles.map(([id, d]) => `<option value="${id}">${echapper(d)}</option>`).join("");
    $("#modele-ia").value = brouillon.modeles[f] || FOURNISSEURS[f].defaut;
    majDescription();
    $("#titre-cle").textContent = `Clé API ${FOURNISSEURS[f].nom}`;
    champCle.value = brouillon.cles[f] || "";
    champCle.placeholder = { claude: "sk-ant-…", gemini: "AIza…", openai: "sk-…" }[f];
    const lien = $("#lien-cle");
    lien.href = FOURNISSEURS[f].pageCle;
    lien.textContent = `Créer une clé : ${FOURNISSEURS[f].pageCle.split("//")[1]}  ↗`;
    $("#resultat-test").textContent = "";
    majTranscription();
  }
  function majDescription() {
    const f = brouillon.fournisseur, m = $("#modele-ia").value.trim();
    const d = FOURNISSEURS[f].modeles.find(([id]) => id === m);
    $("#description-modele").textContent = d ? d[1] : "Modèle personnalisé (vérifie son nom avec « Tester »).";
  }
  const lireIa = segments(choixIa, brouillon.fournisseur, f => { memoriser(); brouillon.fournisseur = f; afficherIa(); });
  $("#modele-ia").oninput = majDescription;
  $("#voir-cle").checked = false;
  champCle.type = "password";
  $("#voir-cle").onchange = () => { champCle.type = $("#voir-cle").checked ? "text" : "password"; };

  // Transcription
  const lireTranscription = segments($("#choix-transcription"), brouillon.transcription, () => majTranscription());
  function majTranscription() {
    const v = lireTranscription?.() ?? brouillon.transcription;
    const aide = $("#aide-transcription");
    $("#ligne-modele-audio").hidden = v !== "gemini";
    // La clé Gemini se saisit ici seulement si l'IA des notes n'est pas déjà Gemini.
    $("#ligne-cle-gemini").hidden = brouillon.fournisseur === "gemini";
    if (v === "gemini") {
      aide.textContent = "L'audio est envoyé à Gemini toutes les 30 secondes. Fiable et précis ; "
        + "environ 0,11 € pour 2 h avec Flash-Lite (gratuit dans la limite du quota gratuit de Google).";
    } else {
      aide.textContent = DicteeAppareil.disponible()
        ? "Utilise la dictée intégrée à l'appareil (Safari sur iPad). Gratuit, mais elle peut perdre quelques "
          + "phrases ; à éviter si la salle est bruyante. Elle utilise toujours le micro par défaut de l'appareil."
        : `⚠️ ${DicteeAppareil.navigateurSansService() || "Ce navigateur ne propose pas la dictée"} : `
          + "utilise Chrome, Edge ou Safari, ou choisis Gemini.";
    }
  }
  $("#liste-modeles-audio").innerHTML = MODELES_AUDIO.map(([id, d]) => `<option value="${id}">${echapper(d)}</option>`).join("");
  $("#modele-audio").value = brouillon.modeleAudio || MODELE_AUDIO_DEFAUT;
  $("#cle-gemini-audio").value = brouillon.cles.gemini || "";
  $("#cle-gemini-audio").oninput = () => { brouillon.cles.gemini = $("#cle-gemini-audio").value.trim(); };
  afficherIa();

  $("#bouton-tester").onclick = async () => {
    memoriser();
    const f = brouillon.fournisseur, m = brouillon.modeles[f] || FOURNISSEURS[f].defaut;
    const r = $("#resultat-test");
    r.className = "petit doux";
    r.textContent = "Test en cours…";
    try {
      const reponse = await rediger(f, m, brouillon.cles[f], "Tu réponds en un seul mot.", "Réponds simplement : OK");
      r.className = "petit ok";
      r.textContent = `✓ Ça marche (${reponse.slice(0, 30)})`;
    } catch (e) {
      r.className = "petit ko";
      r.textContent = `✗ ${e.message}`;
    }
  };

  // Micro
  const choixMicro = $("#choix-micro");
  async function remplirMicros() {
    let entrees = [];
    try { entrees = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audioinput"); } catch { /* */ }
    const nommees = entrees.filter(d => d.label && d.deviceId !== "default" && d.deviceId !== "communications");
    choixMicro.innerHTML = '<option value="">Micro par défaut de l\'appareil</option>'
      + nommees.map(d => `<option value="${echapper(d.deviceId)}">${echapper(d.label)}</option>`).join("");
    if (!nommees.length && entrees.length) {
      choixMicro.innerHTML += '<option value="" disabled>(appuie sur « Tester le micro » pour voir la liste)</option>';
    }
    choixMicro.value = nommees.some(d => d.deviceId === brouillon.micro) ? brouillon.micro : "";
  }
  remplirMicros();
  choixMicro.onchange = () => { brouillon.micro = choixMicro.value; };
  $("#bouton-test-micro").onclick = async () => {
    const bouton = $("#bouton-test-micro"), resultat = $("#resultat-micro"), jauge = $("#jauge-micro");
    const ancien = reglages.micro, choisi = choixMicro.value;
    resultat.style.color = "";
    reglages.micro = choisi;                       // ouvrirMicro lit le réglage
    let flux;
    try { flux = await ouvrirMicro(); } catch (e) {
      reglages.micro = ancien;
      resultat.className = "petit ko";
      resultat.textContent = "✗ Accès au micro refusé. Sur iPad : Réglages → Safari → Micro → Autoriser.";
      return;
    }
    reglages.micro = ancien;
    await remplirMicros();                         // les noms des micros apparaissent après l'autorisation
    if ([...choixMicro.options].some(o => o.value === choisi)) choixMicro.value = choisi;
    bouton.disabled = true;
    resultat.className = "petit ko";
    resultat.textContent = "● Enregistrement… parle maintenant.";
    const ctx = new AudioContext();
    await ctx.resume();
    const analyseur = ctx.createAnalyser();
    analyseur.fftSize = 2048;
    ctx.createMediaStreamSource(flux).connect(analyseur);
    const tampon = new Float32Array(analyseur.fftSize);
    let maximum = 0;
    const morceaux = [];
    let enregistreur = null;
    if (window.MediaRecorder) {
      enregistreur = new MediaRecorder(flux);
      enregistreur.ondataavailable = e => morceaux.push(e.data);
      enregistreur.start();
    }
    const fin = Date.now() + 4000;
    await new Promise(termine => {
      (function suivre() {
        const niveau = niveauSonore(analyseur, tampon);
        maximum = Math.max(maximum, niveau);
        jauge.style.width = `${Math.round(niveau * 100)}%`;
        if (Date.now() < fin) requestAnimationFrame(suivre); else termine();
      })();
    });
    jauge.style.width = "0";
    if (enregistreur) {
      await new Promise(ok => { enregistreur.onstop = ok; enregistreur.stop(); });
    }
    flux.getTracks().forEach(t => t.stop());
    ctx.close();
    bouton.disabled = false;
    if (maximum > 0.45) {
      resultat.className = "petit ok";
      resultat.textContent = "✓ Le micro capte bien le son. Réécoute…";
    } else if (maximum > 0.25) {
      resultat.className = "petit";
      resultat.style.color = "var(--orange)";
      resultat.textContent = "⚠️ Son faible : rapproche-toi de l'enseignant ou utilise un micro externe. Réécoute…";
    } else {
      resultat.className = "petit ko";
      resultat.textContent = "✗ Aucun son capté : choisis un autre micro ou vérifie qu'il est bien branché.";
    }
    if (morceaux.length && maximum > 0.25) {
      const audio = new Audio(URL.createObjectURL(new Blob(morceaux, { type: enregistreur.mimeType })));
      await new Promise(fini => {
        audio.onended = fini;
        audio.play().catch(fini);
        setTimeout(fini, 5000);
      });
    }
    // En mode dictée, on vérifie aussi que la dictée du navigateur comprend quelque chose.
    if (maximum > 0.25 && lireTranscription() === "appareil") {
      bouton.disabled = true;
      await testerDictee($("#resultat-dictee"));
      bouton.disabled = false;
    } else {
      $("#resultat-dictee").textContent = "";
    }
  };

  const lireTheme = segments($("#choix-theme"), brouillon.theme, v => {
    if (v === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = v;
  });

  fen.onclose = () => {
    if (fen.returnValue === "ok") {
      memoriser();
      if (brouillon.fournisseur !== "gemini" && !$("#ligne-cle-gemini").hidden) {
        brouillon.cles.gemini = $("#cle-gemini-audio").value.trim();
      }
      Object.assign(reglages, {
        transcription: lireTranscription(), modeleAudio: $("#modele-audio").value.trim() || MODELE_AUDIO_DEFAUT,
        fournisseur: lireIa(), modeles: brouillon.modeles, cles: brouillon.cles, theme: lireTheme(),
        micro: choixMicro.value,
      });
      sauverReglages();
      $("#etiquette-ia").textContent = nomIa();
      interface_.etiquetteTranscription(0);
      statut("Paramètres enregistrés.");
    }
    appliquerTheme();
  };
  fen.returnValue = "";
  fen.showModal();
}

// ================================================================ Démarrage
function initialiser() {
  appliquerTheme();
  $("#date-jour").textContent = dateLisible(new Date());
  $("#etiquette-ia").textContent = nomIa();
  interface_.etiquetteTranscription(0);
  $("#avec-ia").checked = reglages.avecIa;
  $("#intervalle").value = reglages.intervalle;

  const texteIntervalle = () => {
    const fin = lireMode() === "fin";
    $("#intervalle").disabled = fin || !!seance;
    $("#texte-intervalle").textContent = fin ? "Notes rédigées une seule fois, à la fin du cours"
      : `Notes mises à jour toutes les ${$("#intervalle").value} min`;
  };
  lireMode = segments($("#choix-mode"), reglages.mode, texteIntervalle);
  $("#intervalle").oninput = texteIntervalle;
  texteIntervalle();

  $("#titre").addEventListener("keydown", e => { if (e.key === "Enter") demarrer(); });
  $("#bouton-start").onclick = demarrer;
  $("#bouton-pause").onclick = pause;
  $("#bouton-fin").onclick = terminer;
  $("#bouton-param").onclick = ouvrirParametres;
  $("#bouton-cours").onclick = ouvrirMesCours;
  $("#bouton-word").onclick = () => exporter("docx");
  $("#bouton-copier").onclick = copierPourAbonnement;
  $("#bouton-plus").onclick = () => $("#fen-exports").showModal();
  document.querySelectorAll("[data-export]").forEach(b => {
    b.onclick = () => { $("#fen-exports").close(); exporter(b.dataset.export); };
  });
  setInterval(boucle, 250);

  if (/iPad|iPhone/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) {
    if (!window.matchMedia("(display-mode: standalone)").matches && !navigator.standalone) {
      bandeau("Astuce : Partager → « Sur l'écran d'accueil » pour l'ouvrir comme une appli. "
        + "Pendant le cours, garde l'écran allumé et cette page affichée.");
    }
  }
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

initialiser();
