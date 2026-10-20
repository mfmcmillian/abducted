import { engine, PointerEvents, TextShape } from '@dcl/sdk/ecs'
import { getPlayer } from '@dcl/sdk/players'

/**
 * UI language, following the player's choice in the Antrom AFK wearable. The wearable stores it on
 * the AFK profile (Firebase: players/afk_v1_{wallet}.settings.language, one of en/fr/es/zh) and
 * falls back to the KoA profile's selectedLanguage. We read the same documents, unsigned.
 *
 * t(english, ...args) looks the English source text up in ROWS and returns the current column,
 * substituting {0}, {1}... Unknown strings come back unchanged, so English is always safe.
 */

export type Language = 'en' | 'fr' | 'es' | 'zh'
const COLUMN: Record<Language, number> = { en: 0, fr: 1, es: 2, zh: 3 }
const isLanguage = (v: unknown): v is Language => v === 'en' || v === 'fr' || v === 'es' || v === 'zh'
const KOA_LANGUAGE: Record<string, Language> = { English: 'en', French: 'fr', Spanish: 'es', Chinese: 'zh' }
const BACKEND_URL = 'https://dcl-firebase-backend.vercel.app'

let current: Language = 'en'
const listeners: (() => void)[] = []

export const getLanguage = () => current

export function setLanguage(lang: Language) {
  if (lang === current) return
  current = lang
  retranslateWorld()
  for (const f of listeners) f()
}

/** Run now and again whenever the language changes, for anything built from strings once. */
export function onLanguage(f: () => void) {
  listeners.push(f)
  f()
}

/** Every string t() has produced, back to its source: lets the world pass re-translate texts set once. */
const SOURCE = new Map<string, { key: string; args: (string | number)[] }>()

export function t(text: string, ...args: (string | number)[]): string {
  const row = MAP.get(text)
  let out = (row && row[COLUMN[current]]) || text
  for (let i = 0; i < args.length; i++) out = out.split(`{${i}}`).join(String(args[i]))
  if (row && out !== text) SOURCE.set(out, { key: text, args })
  return out
}

/** Re-translate a string that was produced by t() earlier (or is a plain dictionary key). */
function again(text: string): string {
  const src = SOURCE.get(text)
  if (src) return t(src.key, ...src.args)
  return MAP.has(text) ? t(text) : text
}

/** 3D labels and hover texts are written at creation; rewrite the ones we know when the language changes. */
function retranslateWorld() {
  for (const [entity, shape] of engine.getEntitiesWith(TextShape)) {
    const next = again(shape.text)
    if (next !== shape.text) TextShape.getMutable(entity).text = next
  }
  for (const [entity, pe] of engine.getEntitiesWith(PointerEvents)) {
    if (!pe.pointerEvents.some((p) => p.eventInfo?.hoverText && again(p.eventInfo.hoverText) !== p.eventInfo.hoverText)) continue
    for (const p of PointerEvents.getMutable(entity).pointerEvents) if (p.eventInfo?.hoverText) p.eventInfo.hoverText = again(p.eventInfo.hoverText)
  }
}

/**
 * Pick up the player's wallet once the explorer provides it, then read the wearable's setting and
 * keep re-reading it: the wearable has no channel into the scene, so a change made in the ring
 * shows up here on the next poll. Fast for the first minute, then relaxed.
 */
const POLL_FAST = 3
const POLL_SLOW = 15
const FAST_FOR = 60

export function initLanguage() {
  let tries = 0
  let wallet = ''
  let elapsed = 0
  let nextPoll = 0
  let busy = false
  engine.addSystem(function languageProbe(dt) {
    if (!wallet) {
      const id = getPlayer()?.userId
      if (!id || !/^0x[a-fA-F0-9]{40}$/.test(id)) {
        if (++tries > 600) engine.removeSystem(languageProbe) // ~10 s at 60 fps: a guest or no identity
        return
      }
      wallet = id.toLowerCase()
    }
    elapsed += dt
    if (busy || elapsed < nextPoll) return
    nextPoll = elapsed + (elapsed < FAST_FOR ? POLL_FAST : POLL_SLOW)
    busy = true
    void load(wallet).finally(() => (busy = false))
  })
}

async function load(wallet: string) {
  try {
    const afk = await fetch(`${BACKEND_URL}/player/afk_v1_${wallet}`)
    if (afk.ok) {
      const doc = (await afk.json()) as { settings?: { language?: unknown } }
      if (isLanguage(doc?.settings?.language)) return setLanguage(doc.settings.language)
    }
    const koa = await fetch(`${BACKEND_URL}/player/${wallet}`)
    if (koa.ok) {
      const doc = (await koa.json()) as { selectedLanguage?: unknown }
      const code = typeof doc?.selectedLanguage === 'string' ? KOA_LANGUAGE[doc.selectedLanguage] : undefined
      if (code) setLanguage(code)
    }
  } catch (e) {
    console.log('[i18n] language lookup failed', e instanceof Error ? e.message : String(e))
  }
}

// [English, Français, Español, 中文]
const ROWS: ReadonlyArray<readonly [string, string, string, string]> = [
  // --- game HUD ---
  ['PRACTICE', 'ENTRAÎNEMENT', 'PRÁCTICA', '练习'],
  ['SCORE  {0}', 'SCORE  {0}', 'PUNTOS  {0}', '得分  {0}'],
  ['COWS  {0}', 'VACHES  {0}', 'VACAS  {0}', '奶牛  {0}'],
  ['WASD to fly  ·  look at a cow, click or E to drop the beam', 'ZQSD pour voler  ·  visez une vache, clic ou E pour lancer le rayon', 'WASD para volar  ·  mira una vaca, clic o E para lanzar el rayo', 'WASD 飞行  ·  瞄准奶牛，点击或按 E 放下光束'],
  ['LEAVE GAME', 'QUITTER', 'SALIR DEL JUEGO', '离开游戏'],
  ['EDGE OF THE PASTURE', 'BORD DU PÂTURAGE', 'BORDE DEL PRADO', '牧场边缘'],
  ['BEAM READY', 'RAYON PRÊT', 'RAYO LISTO', '光束就绪'],
  ['CHARGING...', 'CHARGE...', 'CARGANDO...', '充能中...'],
  ['BEAM ACTIVE', 'RAYON ACTIF', 'RAYO ACTIVO', '光束启动'],
  ['COOLDOWN', 'RECHARGE', 'ENFRIAMIENTO', '冷却中'],
  ['GOT ONE!', 'ATTRAPÉE !', '¡UNA MÁS!', '抓到了！'],
  ['the real round starts in a moment', 'la vraie manche commence dans un instant', 'la ronda real empieza en un momento', '正式回合即将开始'],
  [
    'no clock yet: fly over to the cow, look at it, click or E to drop the beam\nthe beam needs a moment to grab, so lead the cow a little',
    "pas de chrono : volez jusqu'à la vache, visez-la, clic ou E pour lancer le rayon\nle rayon met un instant à saisir, visez un peu devant la vache",
    'sin reloj aún: vuela hasta la vaca, mírala, clic o E para lanzar el rayo\nel rayo tarda un momento en agarrar, apunta un poco por delante',
    '尚未计时：飞到奶牛上方，瞄准它，点击或按 E 放下光束\n光束需要片刻才能抓住，请稍微提前瞄准'
  ],
  ['SKIP PRACTICE  (F)', "PASSER L'ENTRAÎNEMENT  (F)", 'SALTAR PRÁCTICA  (F)', '跳过练习  (F)'],
  ['3 minutes · catch as many cows as you can', '3 minutes · attrapez le plus de vaches possible', '3 minutos · atrapa todas las vacas que puedas', '3 分钟 · 尽可能多地抓奶牛'],
  ['TIME!', 'TEMPS !', '¡TIEMPO!', '时间到！'],
  ['ROUND OVER', 'MANCHE TERMINÉE', 'RONDA TERMINADA', '回合结束'],
  ['NEW BEST THIS SESSION', 'NOUVEAU RECORD DE LA SESSION', 'NUEVO RÉCORD DE LA SESIÓN', '本次最佳成绩'],
  ['best this session  {0}', 'record de la session  {0}', 'mejor de la sesión  {0}', '本次最佳  {0}'],
  ['COWS', 'VACHES', 'VACAS', '奶牛'],
  ['DROPS', 'TIRS', 'LANZAMIENTOS', '投放'],
  ['CATCHES', 'PRISES', 'CAPTURAS', '抓获'],
  ['ACCURACY', 'PRÉCISION', 'PRECISIÓN', '命中率'],
  ['PLAY AGAIN  (E)', 'REJOUER  (E)', 'JUGAR OTRA VEZ  (E)', '再玩一次  (E)'],
  ['BACK TO THE DOME  (F)', 'RETOUR AU DÔME  (F)', 'VOLVER A LA CÚPULA  (F)', '返回穹顶  (F)'],
  ['{0} cows beamed into the CARGO BAY. Carry them to the COW LAUNCHER for kudos.', '{0} vaches téléportées dans la SOUTE. Portez-les au LANCE-VACHES pour des kudos.', '{0} vacas teletransportadas a la BODEGA. Llévalas al LANZAVACAS para ganar kudos.', '{0} 头奶牛已传送至货舱。把它们搬到奶牛发射器以获得 Kudos。'],
  ['1 cow beamed into the CARGO BAY. Carry it to the COW LAUNCHER for kudos.', '1 vache téléportée dans la SOUTE. Portez-la au LANCE-VACHES pour des kudos.', '1 vaca teletransportada a la BODEGA. Llévala al LANZAVACAS para ganar kudos.', '1 头奶牛已传送至货舱。把它搬到奶牛发射器以获得 Kudos。'],
  ['no cows caught: nothing for the cargo bay this time', 'aucune vache attrapée : rien pour la soute cette fois', 'ninguna vaca atrapada: nada para la bodega esta vez', '没有抓到奶牛：这次货舱空空如也'],
  ['You scored {0} with {1} cows. They appear to be enjoying it.', 'Vous avez marqué {0} avec {1} vaches. Elles ont l’air d’apprécier.', 'Hiciste {0} puntos con {1} vacas. Parece que lo están disfrutando.', '你用 {1} 头奶牛得到 {0} 分。它们似乎很享受。'],
  ['You scored {0} with 1 cow. It appears to be enjoying it.', 'Vous avez marqué {0} avec 1 vache. Elle a l’air d’apprécier.', 'Hiciste {0} puntos con 1 vaca. Parece que lo está disfrutando.', '你用 1 头奶牛得到 {0} 分。它似乎很享受。'],
  ['Back on the ground. The cows will be waiting.', 'De retour au sol. Les vaches attendront.', 'De vuelta en tierra. Las vacas estarán esperando.', '回到地面。奶牛会等着你。'],
  ['The transfer failed. Step into the pod again.', 'Le transfert a échoué. Entrez de nouveau dans la capsule.', 'La transferencia falló. Entra en la cápsula otra vez.', '传送失败。请再次进入舱体。'],
  ['You slipped out of the saucer. The round does not count.', 'Vous avez glissé hors de la soucoupe. La manche ne compte pas.', 'Te saliste del platillo. La ronda no cuenta.', '你从飞碟中滑出。本回合不计分。'],
  // --- kudos panel ---
  ['ABDUCTED!  KUDOS', 'ABDUCTED!  KUDOS', 'ABDUCTED!  KUDOS', 'ABDUCTED!  KUDOS'],
  ['KUDOS', 'KUDOS', 'KUDOS', 'KUDOS'],
  ['{0} in the cargo bay', '{0} dans la soute', '{0} en la bodega', '货舱中有 {0} 头'],
  ['{0} of yours floating outside', '{0} à vous flottent dehors', '{0} tuyas flotando afuera', '你的 {0} 头漂浮在外'],
  ['black hole in {0}', 'trou noir dans {0}', 'agujero negro en {0}', '黑洞 {0} 后到达'],
  ['10 kudos per floating cow it eats', '10 kudos par vache flottante avalée', '10 kudos por cada vaca flotante que devora', '每吞下一头漂浮的奶牛得 10 Kudos'],
  ['Carrying a cow: click the COW LAUNCHER', 'Vache en main : cliquez sur le LANCE-VACHES', 'Llevas una vaca: haz clic en el LANZAVACAS', '正抱着奶牛：点击奶牛发射器'],
  ['KUDOS buy Alien Costumes from Nov 7', 'Les KUDOS achètent des costumes aliens dès le 7 nov.', 'Los KUDOS compran trajes alienígenas desde el 7 de nov.', '11 月 7 日起可用 Kudos 购买外星服装'],
  ['hold the tab to move  ·  double-tap resets', "maintenez l'onglet pour déplacer  ·  double-clic pour réinitialiser", 'mantén la pestaña para mover  ·  doble clic restablece', '按住标签拖动  ·  双击复位'],
  // --- cargo bay & launcher ---
  ['CARGO BAY', 'SOUTE', 'BODEGA', '货舱'],
  ['Pick up cow', 'Prendre la vache', 'Recoger vaca', '抱起奶牛'],
  ['Load cow', 'Charger la vache', 'Cargar vaca', '装填奶牛'],
  ['empty: play the cow game to catch more cows\n(the saucer waits on the launch pad)', 'vide : jouez au jeu des vaches pour en attraper\n(la capsule attend sur la plateforme)', 'vacía: juega al juego de vacas para atrapar más\n(la cápsula espera en la plataforma)', '空的：玩抓牛游戏来抓更多奶牛\n（舱体在发射台等候）'],
  ['{0} cows waiting{1}\nclick one to carry it to the launcher', '{0} vaches en attente{1}\ncliquez-en une pour la porter au lanceur', '{0} vacas esperando{1}\nhaz clic en una para llevarla al lanzador', '{0} 头奶牛等待中{1}\n点击一头搬到发射器'],
  ['1 cow waiting{1}\nclick it to carry it to the launcher', '1 vache en attente{1}\ncliquez dessus pour la porter au lanceur', '1 vaca esperando{1}\nhaz clic para llevarla al lanzador', '1 头奶牛等待中{1}\n点击它搬到发射器'],
  [' ({0} more in the hold)', ' ({0} de plus dans la cale)', ' ({0} más en la bodega)', '（货舱内还有 {0} 头）'],
  ['You are already carrying a cow. Drop it in the launcher.', 'Vous portez déjà une vache. Déposez-la dans le lanceur.', 'Ya llevas una vaca. Déjala en el lanzador.', '你已经抱着一头奶牛了。把它放进发射器。'],
  ['Got one. Walk it to the COW LAUNCHER by the windows and click the barrel.', 'Attrapée. Portez-la au LANCE-VACHES près des fenêtres et cliquez sur le canon.', 'Tienes una. Llévala al LANZAVACAS junto a las ventanas y haz clic en el cañón.', '抓到了。把它搬到窗边的奶牛发射器，然后点击炮管。'],
  ['Bring a cow from the CARGO BAY first.', "Apportez d'abord une vache de la SOUTE.", 'Trae primero una vaca de la BODEGA.', '先从货舱带一头奶牛过来。'],
  ['No cows to launch. Play the cow game to catch more: the saucer waits on the launch pad.', 'Aucune vache à lancer. Jouez au jeu des vaches : la capsule attend sur la plateforme.', 'No hay vacas que lanzar. Juega al juego de vacas: la cápsula espera en la plataforma.', '没有可发射的奶牛。去玩抓牛游戏：舱体在发射台等候。'],
  ['A black hole is passing the windows. It is taking {0} cows.', 'Un trou noir passe devant les fenêtres. Il emporte {0} vaches.', 'Un agujero negro pasa por las ventanas. Se lleva {0} vacas.', '一个黑洞正经过窗外。它带走了 {0} 头奶牛。'],
  ['A black hole is passing the windows. It is taking 1 cow.', 'Un trou noir passe devant les fenêtres. Il emporte 1 vache.', 'Un agujero negro pasa por las ventanas. Se lleva 1 vaca.', '一个黑洞正经过窗外。它带走了 1 头奶牛。'],
  ['black hole in {0}  ·  {1} of yours floating', 'trou noir dans {0}  ·  {1} à vous flottent', 'agujero negro en {0}  ·  {1} tuyas flotando', '黑洞 {0} 后到达  ·  你的 {1} 头在漂浮'],
  ['{0} KUDOS per cow the black hole swallows\nKUDOS buy Alien Costumes from Nov 7', '{0} KUDOS par vache avalée par le trou noir\nLes KUDOS achètent des costumes aliens dès le 7 nov.', '{0} KUDOS por cada vaca que traga el agujero negro\nLos KUDOS compran trajes alienígenas desde el 7 de nov.', '黑洞每吞下一头奶牛得 {0} KUDOS\n11 月 7 日起可用 Kudos 购买外星服装'],
  ['Raider saucer inbound. It has a cow in its sights.', 'Soucoupe pirate en approche. Elle vise une vache.', 'Platillo saqueador en camino. Tiene una vaca en la mira.', '掠夺飞碟来袭。它盯上了一头奶牛。'],
  // --- leaderboard ---
  ['RANK', 'RANG', 'PUESTO', '名次'],
  ['PILOT', 'PILOTE', 'PILOTO', '飞行员'],
  ['NO SCORES YET — ENTER THE UFO BEAM', 'AUCUN SCORE — ENTREZ DANS LE RAYON', 'SIN PUNTUACIONES — ENTRA EN EL RAYO', '暂无成绩 — 进入飞碟光束'],
  ['BEST ROUND PER PILOT  ·  CURRENT RULESET  ·  COMMUNITY BOARD', 'MEILLEURE MANCHE PAR PILOTE  ·  RÈGLES ACTUELLES  ·  TABLEAU COMMUNAUTAIRE', 'MEJOR RONDA POR PILOTO  ·  REGLAS ACTUALES  ·  TABLA COMUNITARIA', '每位飞行员最佳回合  ·  当前规则  ·  社区榜'],
  // --- showcases, portal, ring, earth, tour ---
  ['Show {0} emote', "Voir l'emote {0}", 'Mostrar emote {0}', '展示 {0} 表情'],
  ['Show suit: {0}', 'Voir le costume : {0}', 'Mostrar traje: {0}', '展示服装：{0}'],
  ['Next emote', 'Emote suivante', 'Siguiente emote', '下一个表情'],
  ['Next costume', 'Costume suivant', 'Siguiente traje', '下一套服装'],
  ['Open selected emote on Marketplace', "Ouvrir l'emote sur le Marketplace", 'Abrir el emote en el Marketplace', '在市场中打开所选表情'],
  ['Not for sale — earned in Dungeons of Antrom', 'Pas à vendre — se gagne dans Dungeons of Antrom', 'No está a la venta — se gana en Dungeons of Antrom', '非卖品 — 在 Dungeons of Antrom 中获得'],
  ['Alien costumes are not for sale. Earn them in Dungeons of Antrom through the purple portal.', 'Les costumes aliens ne sont pas à vendre. Gagnez-les dans Dungeons of Antrom via le portail violet.', 'Los trajes alienígenas no están a la venta. Gánalos en Dungeons of Antrom por el portal morado.', '外星服装不出售。通过紫色传送门在 Dungeons of Antrom 中赢取。'],
  ['CLICK COW TO OPEN\nMARKETPLACE ITEM', 'CLIQUEZ SUR LA VACHE\nPOUR OUVRIR LE MARKETPLACE', 'CLIC EN LA VACA PARA\nABRIR EN EL MARKETPLACE', '点击奶牛打开\n市场商品'],
  ['NOT FOR SALE\nEARNED IN DUNGEONS OF ANTROM', 'PAS À VENDRE\nSE GAGNE DANS DUNGEONS OF ANTROM', 'NO ESTÁ A LA VENTA\nSE GANA EN DUNGEONS OF ANTROM', '非卖品\n在 DUNGEONS OF ANTROM 中获得'],
  ['NOT FOR SALE', 'PAS À VENDRE', 'NO ESTÁ A LA VENTA', '非卖品'],
  ['{0} MANA\n{1} LEFT', '{0} MANA\n{1} RESTANTS', '{0} MANA\n{1} QUEDAN', '{0} MANA\n剩余 {1}'],
  ['Travel to {0}?', 'Voyager vers {0} ?', '¿Viajar a {0}?', '前往 {0}？'],
  ['SOLD OUT', 'ÉPUISÉ', 'AGOTADO', '已售罄'],
  ['Enter {0} — get the alien suit', 'Entrer dans {0} — obtenir le costume alien', 'Entrar en {0} — consigue el traje alienígena', '进入 {0} — 获取外星服装'],
  ["{0}'s costume", 'Costume de {0}', 'Traje de {0}', '{0} 的服装'],
  ['Claim your Antrom Guildstone Ring', 'Réclamez votre Antrom Guildstone Ring', 'Reclama tu Antrom Guildstone Ring', '领取你的 Antrom Guildstone Ring'],
  ['Watch: how the Guildstone Ring works', 'Regarder : comment fonctionne le Guildstone Ring', 'Ver: cómo funciona el Guildstone Ring', '观看：Guildstone Ring 如何运作'],
  ['You already claimed your Antrom Guildstone Ring.', 'Vous avez déjà réclamé votre Antrom Guildstone Ring.', 'Ya reclamaste tu Antrom Guildstone Ring.', '你已经领取过 Antrom Guildstone Ring。'],
  ['The aliens are checking your wallet...', 'Les aliens vérifient votre portefeuille...', 'Los alienígenas están revisando tu billetera...', '外星人正在检查你的钱包...'],
  ['Sign in with a wallet to claim the Antrom Guildstone Ring.', 'Connectez-vous avec un portefeuille pour réclamer l’Antrom Guildstone Ring.', 'Inicia sesión con una billetera para reclamar el Antrom Guildstone Ring.', '请使用钱包登录以领取 Antrom Guildstone Ring。'],
  ['The ring vault is sealed right now. Try again later.', 'Le coffre aux anneaux est scellé pour l’instant. Réessayez plus tard.', 'La bóveda de anillos está sellada ahora. Inténtalo más tarde.', '戒指金库暂时封闭。请稍后再试。'],
  ['The aliens could not hand over a ring right now. Try again later.', 'Les aliens n’ont pas pu remettre d’anneau pour l’instant. Réessayez plus tard.', 'Los alienígenas no pudieron entregar un anillo ahora. Inténtalo más tarde.', '外星人暂时无法交付戒指。请稍后再试。'],
  ['An Antrom Guildstone Ring is on its way to your wallet. They appear to be enjoying it.', 'Un Antrom Guildstone Ring est en route vers votre portefeuille. Ils ont l’air d’apprécier.', 'Un Antrom Guildstone Ring va de camino a tu billetera. Parece que lo están disfrutando.', '一枚 Antrom Guildstone Ring 正在送往你的钱包。他们似乎很享受。'],
  ['No answer from the mothership. The ring server may be offline, try again later.', 'Pas de réponse du vaisseau-mère. Le serveur est peut-être hors ligne, réessayez plus tard.', 'Sin respuesta de la nave nodriza. El servidor puede estar fuera de línea, inténtalo más tarde.', '母舰没有回应。戒指服务器可能离线，请稍后再试。'],
  ['Zoom to Earth', 'Zoom vers la Terre', 'Zoom a la Tierra', '飞向地球'],
  ['E to skip', 'E pour passer', 'E para saltar', '按 E 跳过'],
  ['E to leave', 'E pour quitter', 'E para salir', '按 E 离开'],
  ['Back on the deck. Click the Earth any time to watch again.', 'De retour sur le pont. Cliquez sur la Terre pour revoir.', 'De vuelta en cubierta. Haz clic en la Tierra para verlo otra vez.', '回到甲板。随时点击地球再看一次。'],
  ['Take the tour', 'Faire la visite', 'Hacer el recorrido', '开始导览'],
  ['E to skip the tour', 'E pour passer la visite', 'E para saltar el recorrido', '按 E 跳过导览'],
  ['Click the cow any time for the tour again.', 'Cliquez sur la vache pour refaire la visite.', 'Haz clic en la vaca para repetir el recorrido.', '随时点击奶牛再次导览。'],
  [
    '"Moo. ...Apologies, wrong channel. This is the ship. You clicked the cow. Everyone clicks the cow. Very well: the tour."',
    '« Meuh. ...Pardon, mauvais canal. Ici le vaisseau. Vous avez cliqué sur la vache. Tout le monde clique sur la vache. Très bien : la visite. »',
    '"Muu. ...Disculpen, canal equivocado. Habla la nave. Hicieron clic en la vaca. Todos hacen clic en la vaca. Muy bien: el recorrido."',
    '“哞。……抱歉，频道错了。这里是飞船。你点了奶牛。每个人都点奶牛。好吧：开始导览。”'
  ],
  [
    '"This ship runs on a black hole. It will eat anything, but it only purrs on organic matter: carbon, water, a little grass. Feed it rocks and it sulks, and the lights go out. Ours was starting to sulk."',
    '« Ce vaisseau fonctionne grâce à un trou noir. Il avale tout, mais il ne ronronne qu’avec de la matière organique : du carbone, de l’eau, un peu d’herbe. Nourrissez-le de cailloux et il boude, et les lumières s’éteignent. Le nôtre commençait à bouder. »',
    '"Esta nave funciona con un agujero negro. Se come cualquier cosa, pero solo ronronea con materia orgánica: carbono, agua, un poco de hierba. Dale piedras y se enfurruña, y se apagan las luces. El nuestro empezaba a enfurruñarse."',
    '“这艘船靠黑洞运转。它什么都吃，但只有有机物才能让它满足：碳、水、一点草。喂它石头它就闹脾气，灯光就会熄灭。我们的黑洞开始闹脾气了。”'
  ],
  [
    '"So we went shopping. Third planet from that star, the blue one. Earth. Over a billion cows. Dense, docile, mostly water, and nobody counts them."',
    '« Alors on a fait les courses. Troisième planète de cette étoile, la bleue. La Terre. Plus d’un milliard de vaches. Denses, dociles, surtout de l’eau, et personne ne les compte. »',
    '"Así que fuimos de compras. Tercer planeta de esa estrella, el azul. La Tierra. Más de mil millones de vacas. Densas, dóciles, casi todo agua, y nadie las cuenta."',
    '“于是我们去采购。那颗恒星的第三颗行星，蓝色的那颗。地球。十亿多头奶牛。密实、温顺、大部分是水，而且没人数它们。”'
  ],
  [
    '"The transfer pod. Step inside and we drop you in a saucer over the pastures. Beam up as many cows as you can before the farmers notice. Yes, the pod is large. We had a budget."',
    '« La capsule de transfert. Entrez et nous vous déposons dans une soucoupe au-dessus des pâturages. Téléportez autant de vaches que possible avant que les fermiers ne s’en aperçoivent. Oui, la capsule est grande. Nous avions un budget. »',
    '"La cápsula de transferencia. Entra y te dejamos en un platillo sobre los pastos. Abduce todas las vacas que puedas antes de que los granjeros se den cuenta. Sí, la cápsula es grande. Teníamos presupuesto."',
    '“传送舱。走进去，我们就把你放进牧场上空的飞碟。在农夫发现之前尽可能多地吸走奶牛。是的，舱体很大。我们有预算。”'
  ],
  [
    '"Everything you beam up lands here, in the cargo bay. Pick one up — they do not mind — and carry it to the launcher."',
    '« Tout ce que vous téléportez atterrit ici, dans la soute. Prenez-en une — elles ne s’en formalisent pas — et portez-la au lanceur. »',
    '"Todo lo que abduces aterriza aquí, en la bodega. Toma una — no les importa — y llévala al lanzador."',
    '“你吸上来的一切都落在这里，货舱。抱起一头——它们不介意——搬到发射器去。”'
  ],
  [
    '"The launcher. It feeds the black hole out past the glass. Every cow you throw in earns kudos. Kudos is a currency. It buys nothing. We are very proud of it."',
    '« Le lanceur. Il nourrit le trou noir, derrière la vitre. Chaque vache lancée rapporte des kudos. Le kudos est une monnaie. Il n’achète rien. Nous en sommes très fiers. »',
    '"El lanzador. Alimenta al agujero negro, más allá del cristal. Cada vaca que lanzas da kudos. El kudos es una moneda. No compra nada. Estamos muy orgullosos."',
    '“发射器。它把奶牛送进玻璃外的黑洞。每扔进一头都能得到 Kudos。Kudos 是一种货币。什么也买不到。我们非常自豪。”'
  ],
  [
    '"Your catches go on the board. The finest abductors in the fleet. Most of them are you."',
    '« Vos prises vont au tableau. Les meilleurs ravisseurs de la flotte. La plupart, c’est vous. »',
    '"Tus capturas van a la tabla. Los mejores abductores de la flota. La mayoría eres tú."',
    '“你的战绩会上榜。舰队中最出色的绑架者。大多数都是你。”'
  ],
  [
    '"Now, the mistake. On the fourth pass the beam took a couple: two humans, from a pickup truck, mid-argument. Protocol says return them. Oddly enough... they did not want to go. They danced. We recorded it. You may own the dance."',
    '« Maintenant, l’erreur. Au quatrième passage, le rayon a pris un couple : deux humains, dans un pick-up, en pleine dispute. Le protocole dit de les rendre. Curieusement... ils ne voulaient pas partir. Ils ont dansé. Nous avons enregistré. Vous pouvez posséder la danse. »',
    '"Ahora, el error. En la cuarta pasada el rayo se llevó a una pareja: dos humanos, en una camioneta, en plena discusión. El protocolo dice devolverlos. Curiosamente... no querían irse. Bailaron. Lo grabamos. Puedes poseer el baile."',
    '“现在说说那个失误。第四次掠过时，光束抓到了一对情侣：两个人类，坐在皮卡里，正在吵架。规程说要送他们回去。奇怪的是……他们不想走。他们跳起了舞。我们录了下来。你可以拥有这支舞。”'
  ],
  [
    '"They also asked for suits like ours. We said no. They made their own. They are, honestly, better than ours."',
    '« Ils ont aussi demandé des costumes comme les nôtres. Nous avons dit non. Ils ont fait les leurs. Ils sont, franchement, mieux que les nôtres. »',
    '"También pidieron trajes como los nuestros. Dijimos que no. Hicieron los suyos. Son, sinceramente, mejores que los nuestros."',
    '“他们还想要我们这样的服装。我们拒绝了。他们就自己做了。说实话，比我们的好看。”'
  ],
  [
    '"A gift from friends in another world: the Guildstone ring. Free to claim. Take one. It is not organic. We checked."',
    '« Un cadeau d’amis d’un autre monde : l’anneau Guildstone. Gratuit. Prenez-en un. Il n’est pas organique. Nous avons vérifié. »',
    '"Un regalo de amigos de otro mundo: el anillo Guildstone. Gratis. Toma uno. No es orgánico. Lo comprobamos."',
    '“来自另一个世界朋友的礼物：Guildstone 戒指。免费领取。拿一枚吧。它不是有机物。我们检查过了。”'
  ],
  [
    '"That portal leads to the dungeons. Different ship. Different problems."',
    '« Ce portail mène aux donjons. Autre vaisseau. Autres problèmes. »',
    '"Ese portal lleva a las mazmorras. Otra nave. Otros problemas."',
    '“那个传送门通往地下城。另一艘船。另一些麻烦。”'
  ],
  [
    '"That is the tour. The pod is waiting. Bring us cows. And if you meet the couple... they are the ones enjoying it."',
    '« Voilà la visite. La capsule attend. Rapportez-nous des vaches. Et si vous croisez le couple... ce sont ceux qui apprécient. »',
    '"Ese es el recorrido. La cápsula espera. Tráenos vacas. Y si ves a la pareja... son los que lo están disfrutando."',
    '“导览到此结束。舱体在等你。给我们带奶牛来。如果你遇到那对情侣……他们就是乐在其中的那两位。”'
  ],
  // --- shared cosmos ---
  ['The black hole has fed on {0} cows. It is bigger now.', 'Le trou noir a avalé {0} vaches. Il a grossi.', 'El agujero negro se ha comido {0} vacas. Ahora es más grande.', '黑洞已经吞下 {0} 头奶牛。它变大了。'],
  ['A second ship has warped in alongside. Word is getting around.', 'Un second vaisseau vient de sortir de distorsion à côté de nous. La nouvelle se répand.', 'Una segunda nave acaba de salir del warp a nuestro lado. Se está corriendo la voz.', '第二艘飞船跃迁到了我们旁边。消息传开了。'],
  ['{0} cows fed by everyone', '{0} vaches données par tout le monde', '{0} vacas entregadas entre todos', '大家共投喂 {0} 头奶牛'],
  ['{0} more and the hole grows', 'encore {0} et le trou grossit', '{0} más y el agujero crece', '再喂 {0} 头黑洞就会变大'],
  ['the hole is as big as it gets', 'le trou est au maximum', 'el agujero ya no crece más', '黑洞已达到最大'],
  // --- radio ---
  ['Listen to the radio', 'Écouter la radio', 'Escuchar la radio', '收听广播'],
  ['VOLUME UP  ·  Episode {0}: {1}', 'MONTEZ LE SON  ·  Épisode {0} : {1}', 'SUBE EL VOLUMEN  ·  Episodio {0}: {1}', '请调高音量  ·  第 {0} 集：{1}'],
  ['DALE & TAMMY  ·  LIVE FROM THE COW SHIP', 'DALE & TAMMY  ·  EN DIRECT DU VAISSEAU À VACHES', 'DALE Y TAMMY  ·  EN VIVO DESDE LA NAVE DE LAS VACAS', 'DALE 和 TAMMY  ·  奶牛飞船现场直播'],
  ['ON AIR  ·  Episode {0}: {1}', 'À L’ANTENNE  ·  Épisode {0} : {1}', 'AL AIRE  ·  Episodio {0}: {1}', '直播中  ·  第 {0} 集：{1}'],
  ['{0} episodes on the dial  ·  click to listen', '{0} épisodes sur le cadran  ·  cliquez pour écouter', '{0} episodios en el dial  ·  haz clic para escuchar', '频道里有 {0} 集  ·  点击收听'],
  ['click to listen', 'cliquez pour écouter', 'haz clic para escuchar', '点击收听'],
  ['next episode when the hole has eaten {0} cows', 'prochain épisode quand le trou aura avalé {0} vaches', 'próximo episodio cuando el agujero se haya comido {0} vacas', '黑洞吃掉 {0} 头奶牛后解锁下一集'],
  ['New episode on the radio by the door: "{0}"', 'Nouvel épisode à la radio près de la porte : « {0} »', 'Nuevo episodio en la radio junto a la puerta: "{0}"', '门边的收音机有新一集：“{0}”'],
  ['The Pickup', 'Le pick-up', 'La camioneta', '皮卡'],
  ['Ten', 'Dix', 'Diez', '十'],
  ['Thirty', 'Trente', 'Treinta', '三十'],
  ['Mauve', 'Mauve', 'Malva', '淡紫'],
  ['Company', 'De la compagnie', 'Compañía', '有伴了'],
  ['Three Hundred', 'Trois cents', 'Trescientas', '三百'],
  // ep1
  ["This is Tammy Pruitt, and that's my husband Dale, and we are broadcasting from inside the thing that took us.", 'Ici Tammy Pruitt, et voici mon mari Dale, et nous émettons depuis l’intérieur de la chose qui nous a pris.', 'Soy Tammy Pruitt, y este es mi esposo Dale, y transmitimos desde dentro de la cosa que nos llevó.', '我是 Tammy Pruitt，这是我丈夫 Dale，我们正从带走我们的那个东西里面向您播报。'],
  ["We were on Route 14 outside Harlan. The radio quit mid-song. Then every cow in Erwin's field turned its head at once. Same direction. Up.", 'On était sur la Route 14, à la sortie de Harlan. La radio s’est tue au milieu d’une chanson. Puis toutes les vaches du champ d’Erwin ont tourné la tête d’un coup. Même direction. En haut.', 'Íbamos por la Ruta 14, saliendo de Harlan. La radio se cortó a mitad de canción. Luego todas las vacas del campo de Erwin giraron la cabeza a la vez. Misma dirección. Arriba.', '我们在哈伦镇外的 14 号公路上。收音机在歌放到一半时断了。然后 Erwin 地里的每头牛同时转过头。同一个方向。朝上。'],
  ['Dale said it was the weather. Dale says a lot of things are the weather.', 'Dale a dit que c’était le temps. Dale dit que beaucoup de choses sont le temps.', 'Dale dijo que era el clima. Dale dice que muchas cosas son el clima.', 'Dale 说那是天气。Dale 说很多事情都是天气。'],
  ['The light came down white and quiet, like snow falling the wrong way. The truck came with us. The dog did not.', 'La lumière est descendue, blanche et silencieuse, comme de la neige qui tombe à l’envers. Le pick-up est venu avec nous. Pas le chien.', 'La luz bajó blanca y silenciosa, como nieve cayendo al revés. La camioneta vino con nosotros. El perro no.', '光降下来，又白又静，像倒着下的雪。皮卡跟我们一起来了。狗没有。'],
  ["They apologised. Very polite. They said we weren't on the list, and would we like to go home.", 'Ils se sont excusés. Très polis. Ils ont dit qu’on n’était pas sur la liste, et si on voulait rentrer.', 'Se disculparon. Muy educados. Dijeron que no estábamos en la lista, y si queríamos volver a casa.', '他们道了歉。非常礼貌。他们说我们不在名单上，问我们想不想回家。'],
  ["And here is the part I can't explain to you. We looked at each other, and neither one of us said yes.", 'Et voilà la partie que je ne peux pas vous expliquer. On s’est regardés, et aucun de nous deux n’a dit oui.', 'Y esta es la parte que no puedo explicarles. Nos miramos, y ninguno de los dos dijo que sí.', '接下来这部分我没法向你们解释。我们对视了一眼，谁都没有说好。'],
  ["The beds hum here. All night. You get used to it. You get used to it faster than you'd think.", 'Les lits ronronnent ici. Toute la nuit. On s’y fait. On s’y fait plus vite qu’on ne croirait.', 'Las camas zumban aquí. Toda la noche. Te acostumbras. Te acostumbras más rápido de lo que creerías.', '这里的床会嗡嗡响。整夜。你会习惯的。习惯得比你想的快。'],
  // ep2
  ['The hole out the window ate ten cows today. The crew calls that a good start. I call it a number I keep hearing in my sleep.', 'Le trou derrière la fenêtre a avalé dix vaches aujourd’hui. L’équipage appelle ça un bon début. Moi, un chiffre que j’entends dans mon sommeil.', 'El agujero de la ventana se comió diez vacas hoy. La tripulación lo llama un buen comienzo. Yo lo llamo un número que sigo oyendo en sueños.', '窗外的黑洞今天吃了十头牛。船员说这是个好开头。我说这是个我在睡梦中不断听见的数字。'],
  ['He named them. Every one. He says you have to, or they just become a count.', 'Il leur a donné des noms. À chacune. Il dit qu’il le faut, sinon elles ne sont plus qu’un compte.', 'Les puso nombre. A cada una. Dice que hay que hacerlo, o se vuelven solo una cuenta.', '他给它们起了名字。每一头。他说必须这样，不然它们就只是个数目。'],
  ["Number seven was a Gerald. Red collar, white blaze, looked right at me before it went in. Didn't look scared. That's the thing.", 'La septième était un Gerald. Collier rouge, étoile blanche, elle m’a regardé droit dans les yeux avant d’entrer. Pas l’air effrayée. C’est ça, le truc.', 'La número siete era un Gerald. Collar rojo, mancha blanca, me miró fijo antes de entrar. No parecía asustada. Eso es lo raro.', '第七头叫 Gerald。红项圈，白额纹，进去前直直地看着我。不像害怕。问题就在这。'],
  ["Nothing here looks scared. Not the cows. Not us. I've started wondering if that's something they do to you, or something you do to yourself.", 'Rien ici n’a l’air effrayé. Ni les vaches. Ni nous. Je commence à me demander si c’est quelque chose qu’ils vous font, ou qu’on se fait soi-même.', 'Nada aquí parece asustado. Ni las vacas. Ni nosotros. Empiezo a preguntarme si es algo que te hacen, o algo que te haces a ti mismo.', '这里没有什么看起来害怕。牛不怕。我们也不怕。我开始想，这是他们对你做的，还是你对自己做的。'],
  ['After the tenth one, the lights in the long hallway stopped flickering. Steadied right out, like a held breath let go.', 'Après la dixième, les lumières du long couloir ont cessé de clignoter. Elles se sont stabilisées, comme un souffle retenu qu’on relâche.', 'Después de la décima, las luces del pasillo largo dejaron de parpadear. Se estabilizaron, como un aliento contenido que se suelta.', '第十头之后，长走廊的灯不再闪了。稳稳地亮着，像憋住的一口气终于呼出。'],
  ["Keep sending them, folks. I say that like a joke. Listen to me. It isn't coming out like a joke.", 'Continuez à en envoyer. Je dis ça comme une blague. Écoutez-moi. Ça ne sort pas comme une blague.', 'Sigan mandándolas, amigos. Lo digo como un chiste. Escúchenme. No está saliendo como un chiste.', '大家继续送吧。我说得像个玩笑。听听我的声音。它听起来不像玩笑。'],
  // ep3
  ["Thirty. The captain said the hole has filled out. He said it the way you'd talk about a boy after a summer of farm work.", 'Trente. Le capitaine a dit que le trou s’était étoffé. Il l’a dit comme on parle d’un garçon après un été à la ferme.', 'Treinta. El capitán dijo que el agujero se ha rellenado. Lo dijo como se habla de un muchacho tras un verano de trabajo en la granja.', '三十。船长说黑洞长壮了。他说这话的语气，像在说一个干了一夏农活的男孩。'],
  ["It's bigger. I held my thumb up to the glass the way my dad taught me for deer, and it doesn't cover it anymore.", 'Il est plus gros. J’ai levé le pouce devant la vitre comme mon père m’a appris pour les cerfs, et il ne le couvre plus.', 'Es más grande. Puse el pulgar frente al vidrio como me enseñó mi padre para los ciervos, y ya no lo tapa.', '它更大了。我像父亲教我看鹿那样把拇指举到玻璃前，已经遮不住它了。'],
  ["The ship runs warmer now. The walls tick at night, the way a stove ticks cooling. Except they're not cooling.", 'Le vaisseau est plus chaud maintenant. Les murs cliquettent la nuit, comme un poêle qui refroidit. Sauf qu’ils ne refroidissent pas.', 'La nave está más cálida ahora. Las paredes crujen de noche, como una estufa al enfriarse. Solo que no se están enfriando.', '船现在更暖了。墙壁夜里会咔哒响，像炉子冷却时那样。只是它们并没有在冷却。'],
  ["Tammy's been redecorating the pod bay. Curtains. She found fabric somewhere. I didn't ask where.", 'Tammy redécore la baie des capsules. Des rideaux. Elle a trouvé du tissu quelque part. Je n’ai pas demandé où.', 'Tammy está redecorando la bahía de las cápsulas. Cortinas. Encontró tela en alguna parte. No pregunté dónde.', 'Tammy 在重新布置舱室。窗帘。她在哪儿找到了布料。我没问是哪儿。'],
  ['Somebody has to make it a home. You make it a home, and then it is one, and then you stop asking how you got there.', 'Il faut bien que quelqu’un en fasse un foyer. On en fait un foyer, et puis c’en est un, et puis on arrête de se demander comment on est arrivé là.', 'Alguien tiene que hacerlo un hogar. Lo haces un hogar, y luego lo es, y luego dejas de preguntarte cómo llegaste ahí.', '总得有人把它变成家。你把它变成家，然后它就是了，然后你就不再问自己是怎么到这儿的。'],
  ["We are not leaving. I want to be clear that nobody has told us we can't.", 'On ne part pas. Je tiens à préciser que personne ne nous a dit qu’on ne pouvait pas.', 'No nos vamos. Quiero dejar claro que nadie nos ha dicho que no podamos.', '我们不走。我要说清楚，没有人告诉过我们不能走。'],
  // ep4
  ["The sky outside changed colour in the night. Seventy-five cows, the crew says, like it's a weather report.", 'Le ciel dehors a changé de couleur pendant la nuit. Soixante-quinze vaches, dit l’équipage, comme un bulletin météo.', 'El cielo de afuera cambió de color en la noche. Setenta y cinco vacas, dice la tripulación, como si fuera el pronóstico del tiempo.', '外面的天空在夜里变了颜色。七十五头牛，船员说，像在报天气。'],
  ["It's mauve.", 'C’est mauve.', 'Es malva.', '是淡紫色。'],
  ["It's purple.", 'C’est violet.', 'Es morado.', '是紫色。'],
  ["I sold curtains at Ferguson's for eleven years, Dale. It's mauve. It's the exact mauve of a bruise on the third day.", 'J’ai vendu des rideaux chez Ferguson pendant onze ans, Dale. C’est mauve. Exactement le mauve d’un bleu au troisième jour.', 'Vendí cortinas en Ferguson’s once años, Dale. Es malva. El malva exacto de un moretón al tercer día.', '我在 Ferguson 店里卖了十一年窗帘，Dale。是淡紫色。正是淤青第三天的那种淡紫。'],
  ['The captain says the hole is bending light now. Things out the window arrive a half second after they happen. Including, I think, us.', 'Le capitaine dit que le trou courbe la lumière maintenant. Les choses derrière la fenêtre arrivent une demi-seconde après s’être produites. Y compris, je crois, nous.', 'El capitán dice que el agujero ya curva la luz. Lo que hay tras la ventana llega medio segundo después de ocurrir. Incluidos, creo, nosotros.', '船长说黑洞现在能弯曲光线了。窗外的东西在发生半秒之后才到达。我想，包括我们。'],
  ['He stood at that glass four hours yesterday. When I said his name, he answered before I finished saying it.', 'Il est resté devant cette vitre quatre heures hier. Quand j’ai dit son nom, il a répondu avant que j’aie fini de le dire.', 'Ayer estuvo cuatro horas frente a ese vidrio. Cuando dije su nombre, respondió antes de que terminara de decirlo.', '他昨天在那块玻璃前站了四个小时。我叫他名字时，我还没说完他就答应了。'],
  ["Send more cows. It likes them. And I have started to want what it wants, and I'd be lying if I said I minded.", 'Envoyez plus de vaches. Il les aime. Et j’ai commencé à vouloir ce qu’il veut, et je mentirais si je disais que ça me dérange.', 'Manden más vacas. Le gustan. Y yo he empezado a querer lo que él quiere, y mentiría si dijera que me importa.', '多送些牛来。它喜欢。我也开始想要它想要的东西了，要说我介意，那是撒谎。'],
  // ep5
  ['A second ship came out of nothing last night, right beside us. No sound. Just there, the way a thought is suddenly there.', 'Un second vaisseau est sorti de nulle part cette nuit, juste à côté de nous. Aucun bruit. Juste là, comme une pensée est soudain là.', 'Una segunda nave salió de la nada anoche, justo a nuestro lado. Sin ruido. Solo ahí, como una idea que de pronto está ahí.', '昨晚一艘飞船凭空出现在我们旁边。没有声音。就在那儿，像一个念头突然就在那儿。'],
  ["I said it's the in-laws. Tammy didn't laugh. Tammy always laughs at that one.", 'J’ai dit que c’était la belle-famille. Tammy n’a pas ri. Tammy rit toujours à celle-là.', 'Dije que eran los suegros. Tammy no se rio. Tammy siempre se ríe con esa.', '我说是岳父岳母来了。Tammy 没笑。这个笑话她一向会笑。'],
  ["It isn't my mother, Dale. My mother never sat that still.", 'Ce n’est pas ma mère, Dale. Ma mère ne s’est jamais tenue aussi immobile.', 'No es mi madre, Dale. Mi madre nunca se quedó tan quieta.', '那不是我妈，Dale。我妈从没那么一动不动过。'],
  ["The crew's excited. A hole this size draws visitors, they say. A hundred and fifty cows, and we're a destination.", 'L’équipage est excité. Un trou de cette taille attire des visiteurs, disent-ils. Cent cinquante vaches, et nous voilà une destination.', 'La tripulación está emocionada. Un agujero de este tamaño atrae visitantes, dicen. Ciento cincuenta vacas, y ya somos un destino.', '船员很兴奋。他们说这么大的黑洞会引来访客。一百五十头牛，我们成了一个景点。'],
  ['I watched it a long time. It never moved. But around three in the morning every light on it came on at once, and I swear to you they were facing us.', 'Je l’ai observé longtemps. Il n’a jamais bougé. Mais vers trois heures du matin, toutes ses lumières se sont allumées d’un coup, et je vous jure qu’elles étaient tournées vers nous.', 'Lo observé mucho rato. Nunca se movió. Pero cerca de las tres de la mañana todas sus luces se encendieron a la vez, y les juro que estaban mirándonos.', '我看了它很久。它一动不动。可凌晨三点左右，它上面所有的灯同时亮了，我向你们发誓，它们正对着我们。'],
  ["If you see it from the windows, wave. If something waves back, don't tell me how many arms. I've decided I'd rather not know.", 'Si vous le voyez depuis les fenêtres, faites signe. Si quelque chose répond, ne me dites pas combien de bras. J’ai décidé que je préférais ne pas savoir.', 'Si lo ven desde las ventanas, saluden. Si algo saluda de vuelta, no me digan cuántos brazos. He decidido que prefiero no saberlo.', '如果你从窗户看到它，挥挥手。如果有什么挥手回应，别告诉我有几条胳膊。我决定还是不知道的好。'],
  // ep6
  ['Three hundred. The hole takes up half the glass now. You can see it from the bathroom. You can see it with your eyes closed.', 'Trois cents. Le trou occupe la moitié de la vitre maintenant. On le voit depuis la salle de bain. On le voit les yeux fermés.', 'Trescientas. El agujero ocupa la mitad del vidrio ahora. Se ve desde el baño. Se ve con los ojos cerrados.', '三百。黑洞现在占了半扇玻璃。从浴室能看见。闭着眼也能看见。'],
  ["It glows. Soft, like a nightlight in a hallway. I've grown fond of it. That's the word I keep using. Fond.", 'Il luit. Doucement, comme une veilleuse dans un couloir. Je m’y suis attachée. C’est le mot que je répète. Attachée.', 'Brilla. Suave, como una lamparita en un pasillo. Le he tomado cariño. Esa es la palabra que repito. Cariño.', '它会发光。柔柔的，像走廊里的小夜灯。我对它有了感情。我一直用这个词。感情。'],
  ['The captain gave us a plaque. Honorary cargo. We hung it over the bed. The bed hums under it, and now the plaque hums too.', 'Le capitaine nous a donné une plaque. Cargaison honoraire. On l’a accrochée au-dessus du lit. Le lit ronronne dessous, et maintenant la plaque ronronne aussi.', 'El capitán nos dio una placa. Carga honoraria. La colgamos sobre la cama. La cama zumba debajo, y ahora la placa también zumba.', '船长给了我们一块牌匾。荣誉货物。我们把它挂在床头。床在它下面嗡嗡响，现在牌匾也嗡嗡响了。'],
  ["We talked about home last night. Harlan. The porch. Erwin's field with no cows in it. We talked for about a minute.", 'On a parlé de la maison hier soir. Harlan. Le porche. Le champ d’Erwin sans aucune vache. On a parlé environ une minute.', 'Anoche hablamos de casa. Harlan. El porche. El campo de Erwin sin ninguna vaca. Hablamos como un minuto.', '昨晚我们聊起了家。哈伦。门廊。Erwin 那块一头牛也没有的地。我们聊了大概一分钟。'],
  ['Then the beds started up, and the hum got into the talking, and the talking stopped, and that was all right.', 'Puis les lits se sont mis en marche, et le ronronnement est entré dans la conversation, et la conversation s’est arrêtée, et c’était très bien.', 'Luego las camas arrancaron, y el zumbido se metió en la conversación, y la conversación se detuvo, y estuvo bien.', '然后床又响了起来，嗡嗡声钻进了谈话里，谈话停了，那也没什么。'],
  ["This is Dale and Tammy Pruitt, live from the ship. We are enjoying it. We are. Good night, Earth. Leave a light on. Or don't. It finds you either way.", 'Ici Dale et Tammy Pruitt, en direct du vaisseau. On apprécie. Vraiment. Bonne nuit, la Terre. Laissez une lumière allumée. Ou pas. Il vous trouve de toute façon.', 'Somos Dale y Tammy Pruitt, en vivo desde la nave. Lo estamos disfrutando. De verdad. Buenas noches, Tierra. Dejen una luz encendida. O no. Los encuentra igual.', '我们是 Dale 和 Tammy Pruitt，飞船现场直播。我们很享受。真的。晚安，地球。留一盏灯吧。不留也行。它反正会找到你。']
]

const MAP = new Map<string, readonly [string, string, string, string]>(ROWS.map((r) => [r[0], r]))
