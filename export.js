/* Affichage des notes (Markdown -> HTML) et exports : Word (.docx), Markdown, texte. */
"use strict";

function echapper(texte) {
  return texte.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Découpe une ligne en morceaux { texte, gras, italique, code }.
function morceauxEnLigne(texte) {
  const morceaux = [];
  const motif = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let position = 0;
  for (const m of texte.matchAll(motif)) {
    if (m.index > position) morceaux.push({ texte: texte.slice(position, m.index) });
    const t = m[0];
    if (t.startsWith("**")) morceaux.push({ texte: t.slice(2, -2), gras: true });
    else if (t.startsWith("`")) morceaux.push({ texte: t.slice(1, -1), code: true });
    else morceaux.push({ texte: t.slice(1, -1), italique: true });
    position = m.index + t.length;
  }
  if (position < texte.length) morceaux.push({ texte: texte.slice(position) });
  return morceaux;
}

function enLigneHtml(texte) {
  return morceauxEnLigne(texte).map(m => {
    const t = echapper(m.texte);
    if (m.gras) return `<strong>${t}</strong>`;
    if (m.italique) return `<em>${t}</em>`;
    if (m.code) return `<code>${t}</code>`;
    return t;
  }).join("");
}

// Analyse le Markdown des notes en blocs simples, réutilisés pour l'affichage et pour Word.
function analyserMarkdown(md) {
  const blocs = [];
  const lignes = md.split(/\r?\n/);
  for (let i = 0; i < lignes.length; i++) {
    const ligne = lignes[i].replace(/\s+$/, "");
    const brut = ligne.trim();
    if (!brut || /^(-{3,}|\*{3,})$/.test(brut)) continue;
    let m;
    if ((m = brut.match(/^(#{1,6})\s+(.*)/))) {
      blocs.push({ type: "titre", niveau: Math.min(m[1].length, 3), texte: m[2].replace(/\*\*/g, "") });
    } else if (brut.startsWith("|")) {
      const rangees = [];
      while (i < lignes.length && lignes[i].trim().startsWith("|")) {
        const cellules = lignes[i].trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
        if (!cellules.every(c => !c || /^:?-+:?$/.test(c))) rangees.push(cellules);
        i++;
      }
      i--;
      if (rangees.length) blocs.push({ type: "tableau", rangees });
    } else if ((m = ligne.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)/))) {
      blocs.push({
        type: "liste", numerotee: /\d/.test(m[2]),
        niveau: Math.min(Math.floor(m[1].replace(/\t/g, "    ").length / 2), 2), texte: m[3],
      });
    } else if (brut.startsWith(">")) {
      blocs.push({ type: "citation", texte: brut.replace(/^>\s?/, "") });
    } else {
      blocs.push({ type: "paragraphe", texte: brut });
    }
  }
  return blocs;
}

function markdownVersHtml(md) {
  let html = "";
  let listeOuverte = null;
  const fermerListe = () => { if (listeOuverte) { html += `</${listeOuverte}>`; listeOuverte = null; } };
  for (const b of analyserMarkdown(md)) {
    const important = b.texte && b.texte.includes("⚠") ? ' class="important"' : "";
    if (b.type === "liste") {
      const balise = b.numerotee ? "ol" : "ul";
      if (listeOuverte !== balise) { fermerListe(); html += `<${balise}>`; listeOuverte = balise; }
      html += `<li style="margin-left:${b.niveau * 18}px"><span${important}>${enLigneHtml(b.texte)}</span></li>`;
      continue;
    }
    fermerListe();
    if (b.type === "titre") html += `<h${b.niveau}>${echapper(b.texte)}</h${b.niveau}>`;
    else if (b.type === "tableau") {
      html += "<table>" + b.rangees.map((r, n) => "<tr>" + r.map(c =>
        n === 0 ? `<th>${enLigneHtml(c)}</th>` : `<td>${enLigneHtml(c)}</td>`).join("") + "</tr>").join("") + "</table>";
    } else if (b.type === "citation") html += `<blockquote>${enLigneHtml(b.texte)}</blockquote>`;
    else html += `<p><span${important}>${enLigneHtml(b.texte)}</span></p>`;
  }
  fermerListe();
  return html;
}

// ---------------------------------------------------------------- Word (.docx)
let chargementDocx = null;
function chargerDocx() {
  // La bibliothèque Word (800 Ko) n'est chargée qu'au premier export.
  if (window.docx) return Promise.resolve(window.docx);
  chargementDocx ??= new Promise((ok, ko) => {
    const s = document.createElement("script");
    s.src = "vendor/docx.iife.js";
    s.onload = () => ok(window.docx);
    s.onerror = () => { chargementDocx = null; ko(new Error("bibliothèque Word introuvable")); };
    document.head.appendChild(s);
  });
  return chargementDocx;
}

async function markdownVersDocx(md, titreDocument) {
  const D = await chargerDocx();
  const runs = texte => morceauxEnLigne(texte).map(m => new D.TextRun({
    text: m.texte, bold: !!m.gras, italics: !!m.italique, font: m.code ? "Consolas" : undefined,
    highlight: texte.includes("⚠") ? "yellow" : undefined,
  }));
  const enfants = [];
  for (const b of analyserMarkdown(md)) {
    if (b.type === "titre") {
      const niveaux = [D.HeadingLevel.TITLE, D.HeadingLevel.HEADING_1, D.HeadingLevel.HEADING_2];
      enfants.push(new D.Paragraph({ text: b.texte, heading: niveaux[b.niveau - 1] }));
    } else if (b.type === "liste") {
      enfants.push(new D.Paragraph({
        children: runs(b.texte),
        ...(b.numerotee ? { numbering: { reference: "numeros", level: b.niveau } } : { bullet: { level: b.niveau } }),
      }));
    } else if (b.type === "tableau") {
      const largeur = Math.max(...b.rangees.map(r => r.length));
      enfants.push(new D.Table({
        width: { size: 100, type: D.WidthType.PERCENTAGE },
        rows: b.rangees.map((r, n) => new D.TableRow({
          children: Array.from({ length: largeur }, (_, c) => new D.TableCell({
            children: [new D.Paragraph({ children: morceauxEnLigne(r[c] || "").map(m =>
              new D.TextRun({ text: m.texte, bold: n === 0 || !!m.gras, italics: !!m.italique })) })],
          })),
        })),
      }));
      enfants.push(new D.Paragraph({ text: "" }));
    } else if (b.type === "citation") {
      enfants.push(new D.Paragraph({ children: runs(b.texte), indent: { left: 400 } }));
    } else {
      enfants.push(new D.Paragraph({ children: runs(b.texte) }));
    }
  }
  const doc = new D.Document({
    title: titreDocument,
    creator: "Prise de notes CM",
    numbering: {
      config: [{
        reference: "numeros",
        levels: [0, 1, 2].map(niveau => ({
          level: niveau, format: D.LevelFormat.DECIMAL, text: `%${niveau + 1}.`,
          alignment: D.AlignmentType.START,
          style: { paragraph: { indent: { left: 720 * (niveau + 1), hanging: 360 } } },
        })),
      }],
    },
    sections: [{ children: enfants }],
  });
  return D.Packer.toBlob(doc);
}

// ---------------------------------------------------------------- Enregistrer / partager
function nomFichier(titre, extension) {
  const propre = (titre || "Cours").replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 80) || "Cours";
  return `${propre}.${extension}`;
}

/** Sur iPad, ouvre le menu Partager (Word, Fichiers, Drive…) ; sinon télécharge le fichier. */
async function enregistrerFichier(blob, nom) {
  const fichier = new File([blob], nom, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [fichier] }) && /iPad|iPhone|Macintosh/.test(navigator.userAgent)
      && "ontouchend" in document) {
    try {
      await navigator.share({ files: [fichier], title: nom });
      return "partage";
    } catch (e) {
      if (e.name === "AbortError") return "annule";
    }
  }
  const lien = document.createElement("a");
  lien.href = URL.createObjectURL(blob);
  lien.download = nom;
  document.body.appendChild(lien);
  lien.click();
  setTimeout(() => { URL.revokeObjectURL(lien.href); lien.remove(); }, 2000);
  return "telechargement";
}
