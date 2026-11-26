# TaskHive, gestion de projet SaaS (TD1 R5)

Outil de gestion de projet multi-entreprises (inspiré de Trello / Notion / ClickUp) : entreprises, utilisateurs, projets, tâches et tableau Kanban.

Réalisé par **Loïc Restout** ([@vigoRz-c](https://github.com/vigoRz-c)) et
**Léanne Basin** (BUT 3).

Stack : **Node.js 22 + Express 5 + MongoDB 8**, le tout lancé par **Docker Compose**.

## Livrables

| Livrable | Fichier |
|---|---|
| Spécification technique | [rendu/1 - Specification technique.pdf](<rendu/1 - Specification technique.pdf>) |
| Spécification fonctionnelle | [rendu/2 - Specification fonctionnelle.pdf](<rendu/2 - Specification fonctionnelle.pdf>) |

Pour lancer l'application : cloner le dépôt, puis exécuter `docker compose up -d --build` à sa racine.

## Prérequis

Docker et Docker Compose, rien d'autre.

## Démarrage

À la racine du projet :

```bash
docker compose up -d --build
```

Puis ouvrir **http://localhost:3000**.

Le premier démarrage télécharge les images et installe les dépendances dans l'image Docker (1 à 2 minutes). L'application attend que MongoDB soit prête (healthcheck), puis crée les collections, les validateurs, les index et les données de démonstration.

Vérifier que tout tourne :

```bash
docker compose ps                 # app et mongo doivent être « healthy »
curl http://localhost:3000/health # {"status":"ok"}
```

## Comptes de démonstration

Mot de passe commun : **`demo1234`**

| Entreprise | Personne | Poste | Rôle dans l'application | E-mail |
|---|---|---|---|---|
| *(aucune : laisser l'identifiant vide)* | Admin plateforme | Administrateur de la plateforme | superadmin (toutes les entreprises) | admin@taskhive.test |
| `kodexa` | Loïc Restout | CEO | admin | loic.restout@kodexa.test |
| `kodexa` | Camille Perrin | Cheffe de projet | manager | camille.perrin@kodexa.test |
| `kodexa` | Nathan Leroy | Lead développeur | manager | nathan.leroy@kodexa.test |
| `kodexa` | Mathis Caron | Développeur | membre | mathis.caron@kodexa.test |
| `fumosolution` | Clément Lemaire | CEO | admin | clement.lemaire@fumosolution.test |
| `fumosolution` | Léanne Basin | Lead développeuse front-end | manager | leanne.basin@fumosolution.test |
| `fumosolution` | Louka Carpentier | Lead développeur back-end | manager | louka.carpentier@fumosolution.test |
| `fumosolution` | Loïc Restout | Développeur back-end | membre | loic.restout@fumosolution.test |
| `fumosolution` | Maxence Lepeuve | Administrateur bases de données | membre | maxence.lepeuve@fumosolution.test |
| `fumosolution` | Noa Arnould | Administrateur réseau | membre | noa.arnould@fumosolution.test |
| `fumosolution` | Raphael | Administrateur réseau | membre | raphael@fumosolution.test |

Hiérarchie des rôles : **admin** (CEO : gère l'entreprise et les comptes) > **manager** (chef d'équipe : crée et gère les projets) > **membre** (travaille sur les tâches de ses projets).

Se connecter avec `kodexa` puis avec `fumosolution` permet de vérifier l'**isolation** : chaque entreprise ne voit que ses données.
Loïc Restout a un compte distinct dans chacune des deux entreprises, avec un rôle différent (CEO chez Kodexa, développeur back-end chez Fumosolution).
Les postes de Fumosolution reprennent la répartition réelle des projets de l'équipe (Fumobilite, Fumotion, Fumovolution) et les parcours du BUT : développement (Léanne, Louka, Loïc), réseau (Noa, Raphael), bases de données (Maxence).
Fumovolution regroupe Clément, Léanne, Louka, Loïc et Maxence. Noa travaille sur un jeu de stratégie en ligne et Raphael sur l'infrastructure réseau, chacun dans son propre projet.
On peut aussi créer sa propre entreprise avec l'onglet « Créer une entreprise ».

## Utilisation

- **Tableau de bord** : projets avec leur avancement.
- **Projet** : tableau Kanban (À faire / En cours / En revue / Terminé). On fait glisser les cartes pour changer leur statut. Un clic sur une carte ouvre la tâche : modification, attribution, priorité, échéance, étiquettes, commentaires. Le journal d'activité est à droite.
- **Mes tâches** : les tâches qui me sont assignées, tous projets confondus.
- **Équipe** : gestion des utilisateurs (admin).
- **Entreprise** : statistiques, renommage, offre, suppression (admin).

## Configuration

Toute la configuration est dans **`config.env`**. Modifier ce fichier suffit : aucun changement de code n'est nécessaire.

| Variable | Description |
|---|---|
| `MONGO_URI` | Chaîne de connexion MongoDB |
| `MONGO_DB_NAME` | Nom de la base (`taskhive`) |
| `MONGO_MAX_POOL_SIZE`, `MONGO_SERVER_SELECTION_TIMEOUT_MS` | Réglages du driver |
| `MONGO_INITDB_ROOT_USERNAME` / `_PASSWORD` | Compte root créé par le conteneur mongo au premier lancement |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Secret et durée des sessions (**changer le secret en production**) |
| `SEED_DEMO` | `true` : crée les données de démonstration si la base est vide |
| `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD_HASH` | Compte **administrateur de la plateforme** : il voit toutes les entreprises et peut entrer dans chacune. Il se connecte sur l'écran habituel avec son e-mail (l'identifiant d'entreprise n'est pas nécessaire). Seul le hash bcrypt du mot de passe est stocké. Pour en générer un : `docker compose exec app node -e "console.log(require('bcryptjs').hashSync('MOT_DE_PASSE', 12))"` |
| `PORT` | Port interne de l'application |

### Utiliser une autre base MongoDB

On modifie seulement `MONGO_URI` dans `config.env` (adresse du serveur, identifiants, options de connexion), puis on relance `docker compose up -d app` : l'application relit la configuration à son redémarrage. Le code n'a pas à changer.

## Commandes utiles

```bash
docker compose logs -f app                 # journaux de l'application
docker compose exec mongo mongosh -u taskhive -p taskhive-dev-password --authenticationDatabase admin taskhive
docker compose down                        # arrêter (les données sont conservées)
docker compose down -v                     # arrêter ET effacer la base (les données de démo seront recréées)
```

MongoDB est aussi accessible depuis la machine hôte, sur `127.0.0.1:27017` (MongoDB Compass), avec le même compte.

## Contenu du rendu

```
compose.yml                      services app + mongo
Dockerfile                       image de l'application (multi-étapes, non-root)
config.env                       fichier de configuration
README.md                        ce fichier
package.json / package-lock.json dépendances Node.js
src/                             API (Express + driver MongoDB)
public/                          interface web (HTML/CSS/JS)
rendu/                           spécifications technique et fonctionnelle (PDF)
```

## API

API REST JSON sous `/api`. Le détail des routes est dans `rendu/1 - Specification technique.pdf` (section 7). Exemple :

```bash
TOKEN=$(curl -s -X POST localhost:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"companySlug":"kodexa","email":"loic.restout@kodexa.test","password":"demo1234"}' | jq -r .token)
curl -s localhost:3000/api/projects -H "Authorization: Bearer $TOKEN"
```
