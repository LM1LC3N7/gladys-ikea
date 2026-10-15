// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, buttons), in English and French.
// -----------------------------------------------------------------------------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const LABELS = { dirigera: 'DIRIGERA', tradfri: 'TRÅDFRI' };

/** The status of one gateway, or undefined when there is nothing to say. */
export function gatewayStatus(kind, state, count) {
  const label = LABELS[kind];
  const host = state.host ?? '';
  const reason = state.reason ?? '';
  switch (state.phase) {
    case 'bad-host':
      return {
        en: `${label}: the address typed is not valid (an IP address such as 192.168.1.20).`,
        fr: `${label} : l'adresse saisie n'est pas valide (une adresse IP comme 192.168.1.20).`,
      };
    case 'searching':
      return {
        en: `${label}: searching the network…`,
        fr: `${label} : recherche sur le réseau…`,
      };
    case 'not-found':
      return {
        en: `${label}: not found on the network. Type its IP address in the configuration.`,
        fr: `${label} : introuvable sur le réseau. Saisissez son adresse IP dans la configuration.`,
      };
    case 'connecting':
      return {
        en: `${label}: connecting to ${host}…`,
        fr: `${label} : connexion à ${host}…`,
      };
    case 'connected': {
      const name = state.name ? ` « ${state.name} »` : '';
      const nameEn = state.name ? ` "${state.name}"` : '';
      return {
        en: `${label}${nameEn} connected (${host}): ${plural(count, 'device', 'devices')}.`,
        fr: `${label}${name} connecté (${host}) : ${plural(count, 'appareil', 'appareils')}.`,
      };
    }
    case 'unreachable':
      return {
        en: `${label}: ${host} unreachable (${reason}), retrying.`,
        fr: `${label} : ${host} injoignable (${reason}), nouvel essai en cours.`,
      };
    case 'auth':
      return kind === 'dirigera'
        ? {
            en: 'DIRIGERA: the hub refused the access. Pair it again.',
            fr: "DIRIGERA : le hub a refusé l'accès. Appairez-le à nouveau.",
          }
        : {
            en: 'TRÅDFRI: the gateway refused the key. Pair it again with its security code.',
            fr: 'TRÅDFRI : la passerelle a refusé la clé. Appairez-la à nouveau avec son code de sécurité.',
          };
    case 'certificate':
      return {
        en: `DIRIGERA: the certificate of ${host} was not issued by IKEA. Check the address; if it is your hub, turn off the certificate verification.`,
        fr: `DIRIGERA : le certificat de ${host} n'a pas été émis par IKEA. Vérifiez l'adresse ; si c'est bien votre hub, désactivez la vérification du certificat.`,
      };
    default:
      return undefined;
  }
}

export const T = {
  notPaired: {
    en: 'No gateway paired yet. DIRIGERA: press "Pair the DIRIGERA hub", then the action button under the hub. TRÅDFRI: type the security code printed under the gateway in "Pair the TRÅDFRI gateway".',
    fr: "Aucune passerelle appairée. DIRIGERA : utilisez « Appairer le hub DIRIGERA », puis appuyez sur le bouton d'action sous le hub. TRÅDFRI : saisissez le code de sécurité imprimé sous la passerelle dans « Appairer la passerelle TRÅDFRI ».",
  },
  find: {
    found: (lines) => ({
      en: `Found on the network: ${lines.join('; ')}.`,
      fr: `Trouvé sur le réseau : ${lines.join(' ; ')}.`,
    }),
    none: {
      en: 'No IKEA gateway answered on the network (mDNS). Check that it is powered on and on the same network as Gladys, or type its IP address.',
      fr: "Aucune passerelle IKEA n'a répondu sur le réseau (mDNS). Vérifiez qu'elle est allumée et sur le même réseau que Gladys, ou saisissez son adresse IP.",
    },
    failed: (reason) => ({
      en: `The network scan failed (${reason}). Type the IP address of the gateway in the configuration.`,
      fr: `La recherche sur le réseau a échoué (${reason}). Saisissez l'adresse IP de la passerelle dans la configuration.`,
    }),
  },
  dirigera: {
    noHub: {
      en: 'No DIRIGERA hub found on the network: type its IP address in the configuration, save, then pair again.',
      fr: 'Aucun hub DIRIGERA trouvé sur le réseau : saisissez son adresse IP dans la configuration, enregistrez, puis appairez à nouveau.',
    },
    paired: (host) => ({
      en: `DIRIGERA hub paired (${host}). Its devices are in the Discovery tab.`,
      fr: `Hub DIRIGERA appairé (${host}). Ses appareils sont dans l'onglet Découverte.`,
    }),
    notPressed: {
      en: 'The action button under the hub was not pressed within 90 seconds. Press "Pair the DIRIGERA hub" again, then the button.',
      fr: "Le bouton d'action sous le hub n'a pas été appuyé dans les 90 secondes. Utilisez à nouveau « Appairer le hub DIRIGERA », puis le bouton.",
    },
    unreachable: (host, reason) => ({
      en: `The DIRIGERA hub ${host} is unreachable (${reason}). Check its IP address.`,
      fr: `Le hub DIRIGERA ${host} est injoignable (${reason}). Vérifiez son adresse IP.`,
    }),
    certificate: (host) => ({
      en: `The certificate of ${host} was not issued by IKEA: check the address, or turn off the certificate verification if it is your hub.`,
      fr: `Le certificat de ${host} n'a pas été émis par IKEA : vérifiez l'adresse, ou désactivez la vérification du certificat si c'est bien votre hub.`,
    }),
  },
  tradfri: {
    noCode: {
      en: 'Type the security code printed under the gateway (16 characters).',
      fr: 'Saisissez le code de sécurité imprimé sous la passerelle (16 caractères).',
    },
    noGateway: {
      en: 'No TRÅDFRI gateway found on the network: type its IP address in the configuration, save, then pair again.',
      fr: 'Aucune passerelle TRÅDFRI trouvée sur le réseau : saisissez son adresse IP dans la configuration, enregistrez, puis appairez à nouveau.',
    },
    paired: (host) => ({
      en: `TRÅDFRI gateway paired (${host}). Its devices are in the Discovery tab.`,
      fr: `Passerelle TRÅDFRI appairée (${host}). Ses appareils sont dans l'onglet Découverte.`,
    }),
    badCode: {
      en: 'The gateway refused the security code: check the 16 characters printed under it.',
      fr: 'La passerelle a refusé le code de sécurité : vérifiez les 16 caractères imprimés dessous.',
    },
    // A wrong key can look like silence: the gateway may drop the handshake.
    unreachable: (host, reason) => ({
      en: `The TRÅDFRI gateway ${host} did not complete the pairing (${reason}). Check the security code (16 characters) and the IP address of the gateway.`,
      fr: `La passerelle TRÅDFRI ${host} n'a pas terminé l'appairage (${reason}). Vérifiez le code de sécurité (16 caractères) et l'adresse IP de la passerelle.`,
    }),
  },
  badHost: {
    en: 'The address typed is not valid: use an IP address such as 192.168.1.20.',
    fr: "L'adresse saisie n'est pas valide : utilisez une adresse IP comme 192.168.1.20.",
  },
};
