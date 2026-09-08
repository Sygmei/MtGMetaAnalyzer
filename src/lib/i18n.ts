import { tournamentTranslations } from './tournament-i18n';
import { derived, writable } from 'svelte/store';

export type Locale = 'en' | 'fr';
export type TranslationKey = keyof typeof translations.en;

const translations = {
  en: {
    ...tournamentTranslations.en,
    'nav.home': 'Home',
    'nav.sections': 'Navigation',
    'nav.skipToContent': 'Skip to content',
    'nav.loading': 'Loading {page}…',
    'analyzer.deckUrl': 'Deck URL',
    'analyzer.sources': 'Moxfield, Archidekt or ManaBox',
    'analyzer.dateFilter': 'Tournament dates',
    'analyzer.dateHelp': 'Optional. Leave blank to use all available results.',
    'analyzer.analyzing': 'Analyzing…',
    'analyzer.noSaved': 'Your analyses will appear here.',
    'nav.deckAnalyzer': 'Deck Analyzer',
    'nav.deckAnalyzerKicker': 'Add / Cut / Keep',
    'nav.matcher': 'Matcher',
    'nav.matcherKicker': 'Buyer / seller',
    'nav.mtgTools': 'MtG tools',
    'nav.userMenu': 'User menu',
    'nav.account': 'Account',
    'nav.admin': 'User administration',
    'nav.signOut': 'Sign out',
    'home.title': 'Tools',
    'home.analyzerTitle': 'Find cards to keep, cut, and add',
    'home.analyzerDescription': 'Compare your deck with Duel Commander tournament lists.',
    'home.matcherTitle': 'Match wanted and selling lists',
    'home.matcherDescription': 'Find buyers and sellers for the cards on your lists.',
    'home.registeredOnly': 'Account required',
    'analyzer.title': 'Deck Analyzer',
    'analyzer.description': 'Compare your deck with Duel Commander results from MtgTop8.',
    'analyzer.ignoreBefore': 'From',
    'analyzer.ignoreAfter': 'To',
    'analyzer.submit': 'Analyze deck',
    'analyzer.previousAnalyses': 'Previous analyses',
    'analyzer.savedFor': 'Saved for {name}',
    'analyzer.savedCount': '{count} saved',
    'analyzer.loadPreviousFailed': 'Could not load saved analyses.',
    'matcher.title': 'Matcher',
    'matcher.description':
      'Find buyers and sellers for the cards on your saved lists.',
    'matcher.findPeople': 'Find matches',
    'matcher.finding': 'Matching...',
    'matcher.savedLists': 'Saved lists',
    'matcher.addList': 'Add a list',
    'matcher.viewAllUsers': 'Users',
    'matcher.type': 'Type',
    'matcher.lookingFor': "I'm looking for",
    'matcher.selling': "I'm selling",
    'matcher.label': 'Label',
    'matcher.optional': 'Optional',
    'matcher.url': 'URL',
    'matcher.add': 'Add list',
    'matcher.directoryTitle': 'Users and saved lists',
    'matcher.directoryDescription': "Browse each account's looking-for and selling lists.",
    'matcher.filter': 'Filter',
    'matcher.filterPlaceholder': 'Name, username, label, URL',
    'matcher.usersShown': '{count} users shown',
    'matcher.savedListsTotal': '{count} saved lists total',
    'matcher.lookingForShort': 'Looking for',
    'matcher.sellingShort': 'Selling',
    'matcher.noLookingLists': 'No looking-for lists.',
    'matcher.noSellingLists': 'No selling lists.',
    'matcher.noUsersMatch': 'No users match this filter.',
    'matcher.loadUsersFailed': 'Could not load user lists.',
    'matcher.loadSavedListsFailed': 'Could not load saved lists.',
    'matcher.adminCompute': 'Admin compute',
    'matcher.adminComputeTitle': 'Run a match for selected people',
    'matcher.adminComputeDescription': 'Select accounts, then compute buyer and seller overlap only inside that set.',
    'matcher.selectAll': 'Select all',
    'matcher.searchMatchesAs': 'Search matches as',
    'matcher.groupOverlap': 'Group overlap',
    'matcher.userListCounts': '{buyerCount} looking / {sellerCount} selling',
    'matcher.computeSelectedPeople': 'Compute selected people',
    'matcher.loadAccountsFailed': 'Could not load accounts.',
    'matcher.noListsYet': 'No lists yet.',
    'matcher.delete': 'Delete'
  },
  fr: {
    ...tournamentTranslations.fr,
    'nav.home': 'Accueil',
    'nav.sections': 'Navigation',
    'nav.skipToContent': 'Aller au contenu',
    'nav.loading': 'Chargement : {page}…',
    'analyzer.deckUrl': 'URL du deck',
    'analyzer.sources': 'Moxfield, Archidekt ou ManaBox',
    'analyzer.dateFilter': 'Dates des tournois',
    'analyzer.dateHelp': 'Facultatif. Laissez vide pour utiliser tous les résultats disponibles.',
    'analyzer.analyzing': 'Analyse en cours…',
    'analyzer.noSaved': 'Vos analyses apparaîtront ici.',
    'nav.deckAnalyzer': 'Analyseur de deck',
    'nav.deckAnalyzerKicker': 'Ajouts / Retraits / Garder',
    'nav.matcher': 'Matcher',
    'nav.matcherKicker': 'Acheteurs / vendeurs',
    'nav.mtgTools': 'Outils MtG',
    'nav.userMenu': 'Menu utilisateur',
    'nav.account': 'Compte',
    'nav.admin': 'Administration',
    'nav.signOut': 'Se déconnecter',
    'home.title': 'Outils',
    'home.analyzerTitle': 'Trouver les cartes à garder, retirer et ajouter',
    'home.analyzerDescription': 'Comparez votre deck aux listes de tournois Duel Commander.',
    'home.matcherTitle': 'Comparer les listes de recherche et de vente',
    'home.matcherDescription': 'Trouvez des acheteurs et des vendeurs pour les cartes de vos listes.',
    'home.registeredOnly': 'Compte requis',
    'analyzer.title': 'Analyseur de deck',
    'analyzer.description': 'Comparez votre deck aux résultats Duel Commander de MtgTop8.',
    'analyzer.ignoreBefore': 'Du',
    'analyzer.ignoreAfter': 'Au',
    'analyzer.submit': 'Analyser le deck',
    'analyzer.previousAnalyses': 'Analyses passées',
    'analyzer.savedFor': 'Enregistrées pour {name}',
    'analyzer.savedCount': '{count} analyse(s) enregistrée(s)',
    'analyzer.loadPreviousFailed': 'Impossible de charger les analyses enregistrées.',
    'matcher.title': 'Matcher',
    'matcher.description':
      'Trouvez des acheteurs et des vendeurs pour les cartes de vos listes enregistrées.',
    'matcher.findPeople': 'Rechercher',
    'matcher.finding': 'Comparaison...',
    'matcher.savedLists': 'Listes enregistrées',
    'matcher.addList': 'Ajouter une liste',
    'matcher.viewAllUsers': 'Utilisateurs',
    'matcher.type': 'Type',
    'matcher.lookingFor': 'Je recherche',
    'matcher.selling': 'Je vends',
    'matcher.label': 'Libellé',
    'matcher.optional': 'Facultatif',
    'matcher.url': 'URL',
    'matcher.add': 'Ajouter',
    'matcher.directoryTitle': 'Utilisateurs et listes enregistrées',
    'matcher.directoryDescription': 'Parcourez les listes de recherche et de vente de chaque compte.',
    'matcher.filter': 'Filtrer',
    'matcher.filterPlaceholder': 'Nom, identifiant, libellé, URL',
    'matcher.usersShown': '{count} utilisateurs affichés',
    'matcher.savedListsTotal': '{count} listes enregistrées au total',
    'matcher.lookingForShort': 'Recherche',
    'matcher.sellingShort': 'Vente',
    'matcher.noLookingLists': 'Aucune liste de recherche.',
    'matcher.noSellingLists': 'Aucune liste de vente.',
    'matcher.noUsersMatch': 'Aucun utilisateur ne correspond à ce filtre.',
    'matcher.loadUsersFailed': 'Impossible de charger les listes des utilisateurs.',
    'matcher.loadSavedListsFailed': 'Impossible de charger les listes enregistrées.',
    'matcher.adminCompute': 'Calcul admin',
    'matcher.adminComputeTitle': 'Lancer une recherche pour la sélection',
    'matcher.adminComputeDescription': 'Sélectionnez des comptes, puis calculez les recoupements achat/vente uniquement dans ce groupe.',
    'matcher.selectAll': 'Tout sélectionner',
    'matcher.searchMatchesAs': 'Chercher des échanges en tant que',
    'matcher.groupOverlap': 'Recoupement du groupe',
    'matcher.userListCounts': '{buyerCount} recherche / {sellerCount} vente',
    'matcher.computeSelectedPeople': 'Calculer pour la sélection',
    'matcher.loadAccountsFailed': 'Impossible de charger les comptes.',
    'matcher.noListsYet': 'Aucune liste pour le moment.',
    'matcher.delete': 'Supprimer'
  }
} as const;

export const locale = writable<Locale>('en');

export const t = derived(locale, ($locale) => {
  return (key: TranslationKey, params: Record<string, string | number> = {}) => {
    let text: string = translations[$locale][key] || translations.en[key] || key;
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
    return text;
  };
});

export function initLanguage(languages: readonly string[] = getNavigatorLanguages()): void {
  const selected = languages
    .map((language) => language.trim().toLowerCase().split('-')[0])
    .find((language): language is Locale => language === 'fr' || language === 'en');
  locale.set(selected || 'en');
}

function getNavigatorLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') {
    return [];
  }
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}
