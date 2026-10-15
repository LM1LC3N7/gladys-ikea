# IKEA DIRIGERA & TRÅDFRI

Pilotez vos **appareils connectés IKEA** depuis Gladys, via votre **hub
DIRIGERA** ou votre **passerelle TRÅDFRI**, sur votre réseau local : sans cloud,
sans compte IKEA. Les lampes, prises, stores, purificateurs d'air et capteurs
appairés à la passerelle apparaissent dans l'onglet **Découverte** de Gladys,
prêts à être ajoutés. Intégration non officielle, sans lien avec IKEA.

> **Version de développement (0.1).** Construite à partir des API locales
> documentées des deux passerelles et testée contre des passerelles simulées,
> pas encore avec du vrai matériel. Vos retours sont les bienvenus sur le dépôt
> GitHub.

## Ce que vous obtenez

| Appareil IKEA                                        | Dans Gladys                                                                                   |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Ampoules, lampes, rubans LED                         | lampe : marche/arrêt, luminosité, température de couleur (white spectrum), couleur (CWS)      |
| Prises TRETAKT, INSPELNING, TRÅDFRI                  | interrupteur ; puissance, tension, courant et énergie pour l'INSPELNING                       |
| Stores FYRTUR, KADRILJ, PRAKTLYSING, TREDANSEN       | volet : ouvrir, fermer, stop, position ; la batterie                                          |
| Purificateur d'air STARKVIND                         | mode (arrêt, bas, moyen, haut, auto), vitesse, PM2.5, durée de vie du filtre, sécurité enfant |
| VINDSTYRKA, ALPSTUGA, TIMMERFLOTTE                   | température, humidité, PM2.5, indice COV, CO₂ (selon le modèle)                               |
| PARASOLL, BADRING, VALLHORN, détecteur de mouvement  | ouverture, fuite d'eau, mouvement, luminosité ; la batterie                                   |
| SOMRIG, bouton raccourci TRÅDFRI, BILRESA (DIRIGERA) | un bouton par touche et le déclencheur de scène **Bouton d'une télécommande IKEA**            |
| Autres télécommandes                                 | la batterie                                                                                   |

Les appareils sont mis à jour en temps réel : le hub DIRIGERA envoie ses
événements sur un websocket, la passerelle TRÅDFRI notifie chaque changement
(observation CoAP).

## Installation

### Hub DIRIGERA

1. Installez l'intégration, puis ouvrez son onglet **Configuration**.
2. Cliquez sur **Appairer le hub DIRIGERA**, puis appuyez sur le **bouton
   d'action** sous le hub (le petit bouton sur sa face inférieure) dans les
   **90 secondes**.
3. Une fois appairé, ouvrez l'onglet **Découverte** et ajoutez les appareils
   voulus.

### Passerelle TRÅDFRI

1. Repérez le **code de sécurité** imprimé sous la passerelle (16 caractères, à
   côté du QR code).
2. Cliquez sur **Appairer la passerelle TRÅDFRI**, saisissez le code, validez.
3. Ouvrez l'onglet **Découverte** et ajoutez les appareils.

Le code ne sert qu'une fois, à créer un accès propre à Gladys : il n'est pas
conservé. Les deux passerelles peuvent être appairées en même temps.

## Adresse de la passerelle

Les passerelles sont **trouvées seules sur le réseau** (mDNS, via Gladys). Si
la recherche échoue (autre réseau, routeur qui filtre le multicast), saisissez
l'**adresse IP** de la passerelle dans la configuration (par exemple
`192.168.1.20` ; un nom en `.local` ne fonctionne pas depuis le conteneur de
l'intégration). Donnez si possible une adresse fixe à la passerelle dans votre
box. Sans adresse saisie, une passerelle qui a changé d'adresse est retrouvée
toute seule.

Le bouton **Chercher les passerelles IKEA sur le réseau** liste ce qui répond.

## Scènes

- Les **boutons raccourcis et télécommandes** appairés à un hub DIRIGERA
  deviennent des fonctionnalités « bouton » (appui simple, double appui, appui
  long), utilisables dans le déclencheur « Changement d'état d'un appareil ».
- Le déclencheur de scène **Bouton d'une télécommande IKEA** reçoit chaque
  appui, filtré par télécommande, numéro de bouton et type d'appui.
- La **passerelle TRÅDFRI ne transmet pas** les appuis de ses télécommandes ni
  les détections de ses détecteurs de mouvement : seul leur niveau de batterie
  est disponible. Passez-les sur un hub DIRIGERA pour les utiliser dans les
  scènes Gladys.

## Dépannage

- **« introuvable sur le réseau »** : saisissez l'adresse IP de la passerelle.
- **« le hub a refusé l'accès »** : l'accès a été supprimé dans l'application
  IKEA, ou le hub a été réinitialisé : appairez-le à nouveau.
- **« n'a pas été émis par IKEA »** : l'adresse ne désigne pas un hub
  DIRIGERA, ou son certificat a changé. Si c'est bien votre hub, désactivez
  **Vérifier que le certificat du hub a été émis par IKEA**.
- **« la passerelle a refusé la clé »** (TRÅDFRI) : la passerelle a été
  réinitialisée : appairez-la à nouveau avec son code de sécurité.
- **Les appuis d'une télécommande n'apparaissent pas** : seules les
  télécommandes que le hub DIRIGERA présente comme boutons raccourcis envoient
  leurs appuis ; une télécommande liée directement à des lampes les pilote
  sans prévenir le hub.

## Confidentialité

Tout reste sur votre réseau : l'intégration ne parle qu'à votre passerelle,
directement. L'accès donné par le hub (DIRIGERA) ou la clé donnée par la
passerelle (TRÅDFRI) sont conservés par Gladys, jamais affichés dans
l'interface ni écrits dans les journaux.
