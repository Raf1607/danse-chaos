# DANCE CHAOS

Jeu de danse web : musique surprise, aperçu de 5 secondes, caméra optionnelle et score automatique sur 100.

## Lancer le jeu en local

Prérequis : Node.js récent.

```bash
npm install
npm run dev
```

Ouvre l'adresse indiquée par Vite. Pour tester la caméra, utilise `localhost` ou un site HTTPS : les navigateurs bloquent généralement la caméra sur une page HTTP non sécurisée.

## Publier sur GitHub Pages

Le dépôt est configuré avec un workflow GitHub Actions dans `.github/workflows/deploy.yml`. Dans le dépôt, ouvre **Settings → Pages** et choisis **GitHub Actions** comme source de publication. Après le premier déploiement réussi, l'adresse du jeu sera affichée dans Settings → Pages.

## Comment ça marche

- Le joueur importe ses propres fichiers audio (MP3, WAV, OGG) ou lance les pistes synthétiques originales incluses.
- Le jeu choisit une piste au hasard, joue un aperçu de 5 secondes puis lance une séquence à un autre endroit aléatoire.
- La caméra est activée uniquement après un clic et une autorisation explicite.
- La pose est estimée localement dans le navigateur avec MediaPipe Tasks Vision. Les images de la caméra ne sont pas envoyées à un serveur.
- Le score est une estimation ludique, pas un jugement objectif de la danse.

## Les 5 critères

- Originalité (25)
- Rythme (25)
- Énergie (20)
- Variété (15)
- Coordination (15)

## Confidentialité

La caméra ne démarre qu'après action du joueur. Le bouton « Arrêter la caméra » coupe immédiatement le flux. Les fichiers audio restent dans le navigateur et ne sont pas téléversés. Ne filme pas d'autres personnes sans leur accord.

## À propos de Spotify et Deezer

Ce prototype n'intègre pas Spotify ou Deezer. Spotify interdit explicitement l'usage de son catalogue dans les jeux et la synchronisation de ses enregistrements avec du contenu visuel. L'accès développeur Deezer est également restreint. Utilise des fichiers dont tu possèdes les droits ou des pistes sous licence adaptée si tu publies le jeu.
