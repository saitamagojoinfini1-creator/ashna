# ARCANE Messenger

Mini WhatsApp en temps réel avec :
- Messages privés (1-à-1)
- Chat général + canaux
- Groupes
- Upload photos / fichiers / vidéos (max ~4 Mo)
- Appels audio & vidéo (WebRTC basique)
- Interface mobile + desktop

## Lancer en local

```bash
npm install
npm start
```

Ouvre http://localhost:3000

## Déployer gratuitement (Render.com) — recommandé

Netlify n'est **pas adapté** aux WebSockets. Utilise **Render** :

1. Crée un compte sur https://render.com
2. New → Web Service
3. Connecte ton repo GitHub (ou upload le code)
4. Settings :
   - **Build Command** : `npm install`
   - **Start Command** : `node server.js`
   - **Instance** : Free
5. Deploy

Tu obtiens une URL publique (ex: `https://arcane-xxx.onrender.com`)

Envoie ce lien à ton pote → il choisit un pseudo et peut chatter + t'appeler.

### Alternative rapide (sans GitHub)

```bash
# Installer le CLI Render (optionnel)
# Ou simplement zipper le projet et suivre le guide Render "Deploy from local"
```

## Fonctionnalités actuelles

| Feature | OK |
|---------|----|
| Chat général | ✅ |
| Messages privés | ✅ (clique sur une personne en ligne) |
| Canaux | ✅ |
| Groupes | ✅ (création basique) |
| Upload image/fichier/vidéo | ✅ |
| Appels audio/vidéo | ✅ (basique, même réseau ou STUN public) |
| Mobile | ✅ |

## Limitations (version démo)

- Stockage en mémoire (redémarrage = messages perdus)
- Appels WebRTC : qualité variable sans serveur TURN
- Fichiers max ~4 Mo
- Pas encore de comptes persistants (email/mdp)

## Prochaines améliorations possibles

- Base de données (MongoDB / PostgreSQL)
- Comptes avec mot de passe
- Stories
- Réactions & messages épinglés
- Serveur TURN pour appels stables
