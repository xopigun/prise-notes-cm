# Prise de notes CM — version web (iPad)

**👉 Ouvrir l'application : [xopigun.github.io/prise-notes-cm](https://xopigun.github.io/prise-notes-cm/)**

La même application que la version Windows, avec la même interface, dans le navigateur :
elle marche sur **iPad**, Mac, PC, Android, sans rien installer. On l'ajoute à l'écran
d'accueil de l'iPad pour l'ouvrir comme une vraie appli.

- **Transcription en direct**, au choix :
  - **Dictée de l'appareil** (Safari) : gratuite, mais elle peut perdre quelques phrases ;
  - **Gemini** : l'audio est envoyé toutes les 30 secondes. C'est plus fiable, pour environ
    0,11 € les 2 h avec Gemini 3.1 Flash-Lite. Une clé Gemini est nécessaire.
- **Notes rédigées par l'IA** : Claude (**Haiku 5.5** par défaut, le moins cher), Gemini ou OpenAI, en mode Complet, Économique ou
  Fin de cours, comme dans la version Windows (voir son README, « Combien ça coûte ? »).
- **Exports** : Word (.docx), Markdown, transcription (.txt). Sur iPad, le bouton ouvre
  le menu **Partager** (Word, Fichiers, Google Drive, AirDrop…).
- **Copier pour l'abonnement** : colle le cours dans l'appli Gemini, Claude ou ChatGPT.
- **Mes cours** : les cours sont enregistrés dans le navigateur de l'appareil.

## Sur iPad

1. Ouvrir l'adresse de l'application dans **Safari**.
2. **Partager → « Sur l'écran d'accueil »**.
3. Ouvrir **Notes CM** depuis l'écran d'accueil, puis **⚙ Paramètres** : choisir la
   transcription et l'IA, coller les clés API, puis **Tester**.
4. Au premier démarrage, autoriser le micro (et la dictée).

**Pendant le cours : garde l'écran allumé et l'application affichée.** iPadOS coupe le
micro quand l'écran se verrouille ou qu'on passe à une autre appli. L'application demande
à l'iPad de laisser l'écran allumé, et elle te prévient si un passage a pu être perdu. Pour
plus de sûreté : Réglages → Luminosité et affichage → Verrouillage automatique → Jamais.
Tu peux aussi utiliser l'Accès guidé, qui bloque l'iPad sur l'appli.

Si la dictée ne marche pas : Réglages → Général → Clavier → activer la **Dictée**, et
Réglages → Safari → **Micro** → Autoriser.

## Et s'il y a du bruit dans l'amphi ?

Ça marche, avec quelques limites :

- **Le plus important, c'est la distance.** Si l'enseignant parle dans un micro, la sono couvre
  la plupart des bavardages. Sinon, assieds-toi dans les premiers rangs.
- **Transcription par Gemini** : elle a pour consigne de ne garder que la voix de l'enseignant et
  d'ignorer les chuchotements et les bruits. Elle s'en sort bien, mais elle peut se tromper si tes
  voisins parlent plus fort que l'enseignant.
- **Dictée de l'appareil** : elle transcrit la voix la plus forte, sans faire le tri. À éviter dans
  une salle bruyante.
- **Notes** : l'IA a aussi pour consigne d'ignorer les phrases sans rapport avec le cours. Les
  bavardages qui passent dans la transcription n'apparaissent donc normalement pas dans les notes.
- Un micro-cravate ou un petit micro directionnel, branché sur l'iPad et orienté vers l'estrade,
  améliore beaucoup le résultat dans une salle bruyante.

## Clés API et vie privée

Les clés sont enregistrées **uniquement dans le navigateur de l'appareil**. L'application
envoie la transcription (et l'audio, en mode Gemini) **directement** à l'IA choisie, sans
passer par aucun autre serveur.

| IA | Créer une clé |
|---|---|
| Gemini | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| Claude | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |
| OpenAI | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |

Pour ne rien payer : la dictée de l'appareil, puis le bouton **Copier pour l'abonnement**
(par exemple avec l'[offre étudiante Gemini](https://gemini.google/students/)).

## Publication

L'application est publiée depuis le dépôt public
[xopigun/prise-notes-cm](https://github.com/xopigun/prise-notes-cm) avec GitHub Pages.
Ce dépôt est une copie du dossier `prise_notes_cm_web/` du dépôt de travail (privé).
Après chaque modification, il faut recopier le dossier dedans et changer `VERSION` dans `sw.js`.

## Mettre l'application en ligne

C'est un site statique : il suffit d'héberger ce dossier en **HTTPS**, ce qui est
indispensable pour le micro sur iPad. Quelques solutions gratuites :

- **GitHub Pages**, depuis un dépôt **public** (Pages n'est gratuit qu'avec un dépôt public) ;
- **[Netlify Drop](https://app.netlify.com/drop)** : glisser le dossier dans la page ;
- **Cloudflare Pages**.

Après une mise à jour des fichiers, changer `VERSION` dans `sw.js` pour que les
appareils récupèrent la nouvelle version.

## Essayer sur un ordinateur

```
cd prise_notes_cm_web
python3 -m http.server 8000
```

Puis ouvrir <http://localhost:8000>. Le micro est autorisé sur `localhost` sans HTTPS.
La dictée de l'appareil marche dans Safari et Chrome. Dans les autres navigateurs, choisir
Gemini.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html`, `style.css` | la page et son apparence (clair / sombre) |
| `app.js` | enregistrement, transcription, notes, cours enregistrés, paramètres |
| `ia.js` | appels à Claude, Gemini et OpenAI |
| `export.js` | affichage des notes et export Word / Markdown |
| `vendor/docx.iife.js` | bibliothèque [docx](https://github.com/dolanmiu/docx) 9.5.1 (licence MIT), chargée au premier export Word |
| `manifest.webmanifest`, `sw.js`, `icones/` | installation sur l'écran d'accueil et fonctionnement hors ligne |
