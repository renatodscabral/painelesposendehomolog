/* GERADO de public/index.html por gerar_matriz_acessos.mjs (v13.88) — não edite à mão: a matriz da Gestão de Acessos
   (módulos, níveis Ler/Modificar/Excluir, opções extras e telas com as permissões que levam) é a mesma do painel. */
export default {
 "modulos": [
  {
   "id": "pdi",
   "ler": [
    "pessoal.ver"
   ],
   "modificar": [
    "pessoal.editar"
   ],
   "excluir": [
    "pessoal.excluir"
   ],
   "extras": []
  },
  {
   "id": "lojas",
   "ler": [
    "lojas.ver"
   ],
   "modificar": [
    "lojas.editar",
    "lojas.arquivos",
    "ia.resumo"
   ],
   "excluir": [
    "lojas.excluir",
    "lojas.importar"
   ],
   "extras": []
  },
  {
   "id": "contratos",
   "ler": [
    "lojas.contratos.ver"
   ],
   "modificar": [
    "lojas.contratos.editar",
    "lojas.contrato.editar",
    "lojas.arquivos",
    "ia.resumo"
   ],
   "excluir": [
    "lojas.contratos.excluir"
   ],
   "extras": []
  },
  {
   "id": "fcx",
   "ler": [
    "fcx.ver",
    "fcx.dfc.ver"
   ],
   "modificar": [
    "fcx.editar",
    "fcx.dfc.importar",
    "fcx.dfc.contas",
    "fcx.dfc.regras"
   ],
   "excluir": [
    "fcx.excluir"
   ],
   "extras": []
  },
  {
   "id": "retaguarda",
   "ler": [
    "retaguarda.ver",
    "retaguarda.ieo.ver",
    "retaguarda.adq.ver"
   ],
   "modificar": [
    "retaguarda.credsystem.importar",
    "retaguarda.credsystem.editar",
    "retaguarda.faltas.lancar",
    "retaguarda.faltas.status",
    "retaguarda.caixas.editar",
    "retaguarda.ieo.lancar",
    "retaguarda.ieo.matriz",
    "retaguarda.ieo.fechar",
    "retaguarda.ieo.laudo",
    "retaguarda.adq.importar",
    "retaguarda.adq.taxas",
    "retaguarda.ocorrencias.lancar"
   ],
   "excluir": [
    "retaguarda.faltas.excluir",
    "retaguarda.ocorrencias.excluir"
   ],
   "extras": []
  },
  {
   "id": "credsystem",
   "ler": [
    "credsystem.ver"
   ],
   "modificar": [
    "credsystem.editar"
   ],
   "excluir": [
    "credsystem.excluir"
   ],
   "extras": []
  },
  {
   "id": "rh",
   "ler": [
    "rh.ver"
   ],
   "modificar": [
    "rh.importar"
   ],
   "excluir": [],
   "extras": [
    [
     "rh.ver_salarios",
     true,
     "gestao_v1393"
    ]
   ]
  },
  {
   "id": "viagens",
   "ler": [
    "viagens.ver"
   ],
   "modificar": [
    "viagens.pagar"
   ],
   "excluir": [
    "viagens.excluir"
   ],
   "extras": [
    [
     "viagens.solicitar",
     true
    ],
    [
     "viagens.importar",
     false
    ]
   ]
  },
  {
   "id": "solicitacoes",
   "ler": [
    "solicitacoes.ver"
   ],
   "modificar": [
    "solicitacoes.lancar"
   ],
   "excluir": [
    "solicitacoes.atender",
    "solicitacoes.excluir"
   ],
   "extras": [
    [
     "solicitacoes.todas",
     false
    ]
   ]
  },
  {
   "id": "contabil",
   "ler": [
    "contabil.ver"
   ],
   "modificar": [
    "contabil.lancar",
    "contabil.plano"
   ],
   "excluir": [
    "contabil.estornar",
    "contabil.parametros"
   ],
   "extras": [],
   "rec": "contabil_v1386"
  },
  {
   "id": "parceiros",
   "ler": [
    "parceiros.ver"
   ],
   "modificar": [
    "parceiros.editar"
   ],
   "excluir": [
    "parceiros.excluir"
   ],
   "extras": [],
   "rec": "gestao_v1394"
  },
  {
   "id": "visao",
   "ler": [
    "visao.dashboard"
   ],
   "modificar": [],
   "excluir": [],
   "extras": [],
   "v1383": true
  }
 ],
 "telas": {
  "lojas": {
   "mod": "lojas",
   "telas": [
    [
     "dados",
     []
    ],
    [
     "contrato",
     []
    ],
    [
     "adq",
     []
    ],
    [
     "despesas",
     []
    ],
    [
     "seguros",
     []
    ],
    [
     "historico",
     []
    ]
   ]
  },
  "contratos": {
   "mod": "contratos",
   "telas": [
    [
     "lista",
     []
    ],
    [
     "ocupacao",
     []
    ]
   ]
  },
  "fcx": {
   "mod": "fcx",
   "telas": [
    [
     "fcx",
     []
    ],
    [
     "dfc",
     [
      "fcx.dfc.ver",
      "fcx.dfc.importar",
      "fcx.dfc.contas",
      "fcx.dfc.regras"
     ]
    ]
   ]
  },
  "retaguarda": {
   "mod": "retaguarda",
   "telas": [
    [
     "credsystem",
     [
      "retaguarda.credsystem.importar",
      "retaguarda.credsystem.editar"
     ]
    ],
    [
     "faltas",
     [
      "retaguarda.faltas.lancar",
      "retaguarda.faltas.status",
      "retaguarda.faltas.excluir"
     ]
    ],
    [
     "cofre",
     [
      "retaguarda.ocorrencias.lancar",
      "retaguarda.ocorrencias.excluir"
     ]
    ],
    [
     "depositos",
     [
      "retaguarda.ocorrencias.lancar",
      "retaguarda.ocorrencias.excluir"
     ]
    ],
    [
     "ocorrencias",
     [
      "retaguarda.ocorrencias.lancar",
      "retaguarda.ocorrencias.excluir"
     ]
    ],
    [
     "pendencias",
     []
    ],
    [
     "consumidor",
     []
    ],
    [
     "ieo",
     [
      "retaguarda.ieo.ver",
      "retaguarda.ieo.lancar",
      "retaguarda.ieo.matriz",
      "retaguarda.ieo.fechar",
      "retaguarda.ieo.laudo"
     ]
    ],
    [
     "adquirentes",
     [
      "retaguarda.adq.ver",
      "retaguarda.adq.importar",
      "retaguarda.adq.taxas"
     ]
    ]
   ]
  },
  "conciliacao": {
   "mod": "retaguarda",
   "telas": [
    [
     "credito",
     [
      "retaguarda.adq.ver",
      "retaguarda.adq.importar",
      "retaguarda.adq.taxas"
     ]
    ],
    [
     "depositos",
     []
    ],
    [
     "pix",
     []
    ],
    [
     "card",
     []
    ],
    [
     "resumo",
     []
    ]
   ]
  },
  "credsystem": {
   "mod": "credsystem",
   "telas": [
    [
     "campanhas",
     []
    ],
    [
     "metas",
     []
    ],
    [
     "dashboard",
     []
    ],
    [
     "importacoes",
     []
    ]
   ]
  },
  "rh": {
   "mod": "rh",
   "telas": [
    [
     "organograma",
     []
    ],
    [
     "cadastro",
     []
    ],
    [
     "importacoes",
     [
      "rh.importar"
     ]
    ]
   ]
  },
  "menu": {
   "mod": "visao",
   "telas": [
    [
     "recebivel",
     []
    ],
    [
     "indicadores",
     []
    ]
   ]
  }
 }
};
