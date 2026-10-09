// Estado compartilhado do app. Os módulos leem e escrevem aqui em vez de usar variáveis soltas.
export const S = {
  user: null,                // usuário logado (Firebase Auth)
  species: [],               // espécies do usuário
  vases: [],                 // vasos do usuário
  speciesLoaded: false,
  vasesLoaded: false,
  loadError: '',
  selectedSpecies: null,     // espécie aberta na tela de detalhe
  detailVaseId: null,        // vaso aberto no painel de detalhes
  activeDrawerId: null,      // painel lateral aberto
  searchTerm: '',
  speciePhoto: null,         // foto de capa em preparação (data URL)
  vasePhoto: null,           // foto do vaso em preparação (data URL)
  aiImage: null,             // foto enviada ao diagnóstico/identificação
  alertsCollapsed: false,
  aiMode: 'diagnose',        // diagnose | identify
  aiBusy: false,
  lastIdentify: null
};

// Filtros ativos: chaves 'grupo:opção' — OU dentro do grupo, E entre grupos
export const activeFilters = new Set();
