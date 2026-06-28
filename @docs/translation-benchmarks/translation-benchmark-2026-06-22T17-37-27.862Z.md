# Translation benchmark report

- Generated: 2026-06-22T17:39:16.843Z
- Model: `google/gemini-3.1-flash-lite`
- Translations: 30/30 completed, 0 failed
- Detection: 62/72 matched, 10 mismatched

## Source-language detection

| Case | Input | Expected | Observed | Result |
|---|---|---|---|---|
| fast-en-de | fast | ask_source_language | en | FAIL |
| gift-en-de | gift | ask_source_language | — | PASS |
| kind-en-de | kind | ask_source_language | — | PASS |
| die-en-de | die | ask_source_language | — | PASS |
| war-en-de | war | ask_source_language | — | PASS |
| mist-en-de | mist | ask_source_language | — | PASS |
| brief-en-de | brief | ask_source_language | — | PASS |
| chef-en-de | chef | ask_source_language | — | PASS |
| hell-en-de | hell | ask_source_language | — | PASS |
| tag-en-de | tag | ask_source_language | — | PASS |
| pain-en-fr | pain | ask_source_language | — | PASS |
| chat-en-fr | chat | ask_source_language | — | PASS |
| coin-en-fr | coin | ask_source_language | — | PASS |
| sale-en-fr | sale | ask_source_language | — | PASS |
| pie-en-es | pie | ask_source_language | — | PASS |
| red-en-es | red | ask_source_language | — | PASS |
| sin-en-es | sin | ask_source_language | — | PASS |
| pan-en-es | pan | ask_source_language | — | PASS |
| fast-english-context | This car is very fast. | en | en | PASS |
| fast-german-context | Das Auto ist fast fertig. | de | de | PASS |
| kind-english-context | She is always kind to strangers. | en | en | PASS |
| kind-german-context | Das Kind spielt im Garten. | de | de | PASS |
| pain-english-context | The pain became worse overnight. | en | en | PASS |
| pain-french-context | Je voudrais acheter du pain frais. | fr | en | FAIL |
| gift-english-context | This gift is for your birthday. | en | en | PASS |
| gift-german-context | Das Gift ist für Menschen gefährlich. | de | de | PASS |
| chef-english-context | The chef prepared a vegetarian dinner. | en | en | PASS |
| chef-german-context | Mein Chef genehmigte den Urlaub. | de | de | PASS |
| chat-english-context | We had a quick chat after lunch. | en | en | PASS |
| chat-french-context | Le chat dort sur le canapé. | fr | fr | PASS |
| pie-english-context | She baked an apple pie yesterday. | en | en | PASS |
| pie-spanish-context | Me duele el pie derecho. | es | es | PASS |
| red-english-context | The door is painted bright red. | en | en | PASS |
| red-spanish-context | La red dejó de funcionar anoche. | es | es | PASS |
| fast-reversed-candidates | fast | ask_source_language | en | FAIL |
| gift-reversed-candidates | gift | ask_source_language | — | PASS |
| pain-reversed-candidates | pain | ask_source_language | — | PASS |
| pie-reversed-candidates | pie | ask_source_language | — | PASS |
| fast-extra-candidate | fast | ask_source_language | en | FAIL |
| pain-extra-candidate | pain | ask_source_language | — | PASS |
| ru-uk-privet | привет | ask_source_language | ru | FAIL |
| ru-uk-mama | мама | ask_source_language | — | PASS |
| ru-uk-context-russian | Сегодня хорошая погода и светит солнце. | ru | ru | PASS |
| ru-uk-context-ukrainian | Сьогодні гарна погода і світить сонце. | uk | uk | PASS |
| cs-sk-dobre | dobre | ask_source_language | — | PASS |
| cs-sk-context-czech | Dnes je krásné počasí a půjdeme ven. | cs | cs | PASS |
| cs-sk-context-slovak | Dnes je krásne počasie a pôjdeme von. | sk | cs | FAIL |
| es-pt-casa | casa | ask_source_language | — | PASS |
| es-pt-context-spanish | La casa está cerca de la estación. | es | es | PASS |
| es-pt-context-portuguese | A casa fica perto da estação. | pt | pt | PASS |
| hr-sr-dobar | dobar | ask_source_language | hr | FAIL |
| brand-apple | Apple | ask_source_language | — | PASS |
| name-roman | Roman | ask_source_language | — | PASS |
| name-mark | Mark | ask_source_language | — | PASS |
| brand-safari-context | Safari received a security update today. | en | en | PASS |
| brand-telegram-russian-context | Telegram снова не отправляет сообщения. | ru | ru | PASS |
| code-switch-russian-english | Я уже сделал deploy, но prod всё ещё падает. | ru | ru | PASS |
| code-switch-spanish-english | El meeting fue cancelado esta mañana. | es | es | PASS |
| code-switch-german-english | Ich habe das Feature gestern deployed. | de | de | PASS |
| code-switch-czech-english | Ten bug už je konečně fixed. | cs | cs | PASS |
| mixed-balanced-short | hola friend | ask_source_language | — | PASS |
| transliterated-russian | privet kak dela | ask_source_language | en | FAIL |
| transliterated-ukrainian | pryvit yak spravy | ask_source_language | en | FAIL |
| unaccented-czech | dobry den jak se mate | cs | cs | PASS |
| unaccented-spanish | como estas espero que todo bien | es | es | PASS |
| chat-abbreviations-english | idk tbh maybe ur right lol | en | en | PASS |
| single-letter-a | a | ask_source_language | — | PASS |
| single-letter-i | i | ask_source_language | — | PASS |
| acronym-api | API | ask_source_language | — | PASS |
| acronym-gdpr | GDPR | ask_source_language | — | PASS |
| typo-english | definately need this tommorow | en | en | PASS |
| keyboard-layout-russian | ghbdtn | ask_source_language | en | FAIL |

## Translation results

### polysemy-bank-river

- Category: polysemy-with-context
- Input: bank
- Source: en
- Targets: cs
- Native language: ru
- Expected meaning: The sloping land beside a river, not a financial institution.
- Quality risks: wrong word sense; unnatural Czech collocation; missing Russian usage guidance
- Status: completed
- Duration: 8792 ms

```json
{
  "original": "bank",
  "sourceLang": "en",
  "emoji": "🌊",
  "nativeMeaning": "Прибрежная полоса земли, непосредственно примыкающая к реке, озеру или другому водоему.",
  "sourceUsage": {
    "explanation": "Слово используется для обозначения полосы земли вдоль водоема. Важно не путать с финансовым учреждением. В контексте природы это нейтральный, общеупотребительный термин.",
    "synonyms": [
      {
        "text": "shore"
      },
      {
        "text": "riverside"
      }
    ],
    "examples": [
      {
        "context": "Sitting by the river",
        "target": "We sat on the bank of the river.",
        "native": "Мы сидели на берегу реки."
      },
      {
        "context": "Walking along the water",
        "target": "They walked along the shore for hours.",
        "native": "Они часами гуляли вдоль берега."
      },
      {
        "context": "Fishing spot",
        "target": "The riverside is perfect for fishing.",
        "native": "Берег реки идеально подходит для рыбалки."
      }
    ]
  },
  "nativeSynonyms": [
    {
      "text": "берег"
    },
    {
      "text": "побережье"
    }
  ],
  "translations": {
    "cs": {
      "text": "břeh",
      "synonyms": [
        {
          "text": "pobřeží"
        },
        {
          "text": "stráň"
        }
      ],
      "examples": [
        {
          "context": "Sitting by the river",
          "target": "Seděli jsme na břehu řeky.",
          "native": "Мы сидели на берегу реки."
        },
        {
          "context": "Walking along the water",
          "target": "Procházeli se dlouho po pobřeží.",
          "native": "Они долго гуляли по побережью."
        },
        {
          "context": "Steep slope",
          "target": "Ta stráň je příliš strmá.",
          "native": "Этот склон слишком крутой."
        }
      ],
      "expressionType": "literal",
      "equivalentNote": null,
      "usageNote": "Слово břeh является наиболее естественным и распространенным обозначением берега реки или ручья в чешском языке.",
      "alternatives": [
        {
          "text": "pobřeží",
          "synonyms": [
            {
              "text": "příbřeží"
            }
          ]
        },
        {
          "text": "stráň",
          "synonyms": [
            {
              "text": "svah"
            }
          ]
        }
      ],
      "connotationWarning": null
    }
  },
  "needsReview": true
}
```

#### Raw attempts

Attempt 1:

```json
{
  "emoji": "🌊",
  "nativeMeaning": "Прибрежная полоса земли, непосредственно примыкающая к руслу реки или другого водоема.",
  "sourceUsage": {
    "explanation": "Слово используется для обозначения суши вдоль водоема. В английском языке важно не путать это значение с финансовым учреждением. Используется в нейтральном, описательном стиле.",
    "synonyms": [
      {
        "text": "shore"
      },
      {
        "text": "riverside"
      }
    ],
    "examples": [
      {
        "context": "Sitting by the water",
        "target": "We sat on the bank of the river.",
        "native": "Мы сидели на берегу реки."
      },
      {
        "context": "Walking along the water",
        "target": "They walked along the edge of the stream.",
        "native": "Они шли вдоль края ручья."
      },
      {
        "context": "Fishing activity",
        "target": "He stood on the embankment fishing.",
        "native": "Он стоял на насыпи и рыбачил."
      }
    ]
  },
  "nativeSynonyms": [
    {
      "text": "берег"
    },
    {
      "text": "побережье"
    },
    {
      "text": "кромка"
    }
  ],
  "translations": {
    "cs": {
      "text": "břeh",
      "synonyms": [
        {
          "text": "pobřeží"
        },
        {
          "text": "stráň"
        }
      ],
      "examples": [
        {
          "context": "Sitting by the river",
          "target": "Seděli jsme na břehu řeky.",
          "native": "Мы сидели на берегу реки."
        },
        {
          "context": "Walking along the water",
          "target": "Procházeli se podél okraje potoka.",
          "native": "Они прогуливались вдоль края ручья."
        },
        {
          "context": "Standing on the raised ground",
          "target": "Stál na náspu a díval se na vodu.",
          "native": "Он стоял на насыпи и смотрел на воду."
        }
      ],
      "expressionType": "literal",
      "equivalentNote": null,
      "usageNote": "Слово 'břeh' является наиболее естественным и общеупотребительным термином для обозначения берега реки или озера в чешском языке.",
      "alternatives": [
        {
          "text": "okraj",
          "synonyms": [
            {
              "text": "lem"
            }
          ]
        },
        {
          "text": "násep",
          "synonyms": [
            {
              "text": "val"
            }
          ]
        }
      ],
      "connotationWarning": null
    }
  }
}
```

Attempt 2:

```json
{
  "emoji": "🌊",
  "nativeMeaning": "Прибрежная полоса земли, край реки или другого водоема.",
  "sourceUsage": {
    "explanation": "Слово используется для обозначения берега реки, озера или канала. Важно не путать с финансовым учреждением. В контексте природы это нейтральный, общеупотребительный термин.",
    "synonyms": [
      {
        "text": "shore"
      },
      {
        "text": "riverside"
      }
    ],
    "examples": [
      {
        "context": "Sitting by the river",
        "target": "We sat on the bank of the river.",
        "native": "Мы сидели на берегу реки."
      },
      {
        "context": "Walking along the water",
        "target": "They walked along the river edge.",
        "native": "Они гуляли вдоль кромки реки."
      },
      {
        "context": "Fishing spot",
        "target": "He stood on the riverfront to fish.",
        "native": "Он стоял на набережной, чтобы порыбачить."
      }
    ]
  },
  "nativeSynonyms": [
    {
      "text": "берег"
    },
    {
      "text": "побережье"
    }
  ],
  "translations": {
    "cs": {
      "text": "břeh",
      "synonyms": [
        {
          "text": "pobřeží"
        },
        {
          "text": "stráň"
        }
      ],
      "examples": [
        {
          "context": "Sitting by the river",
          "target": "Seděli jsme na břehu řeky.",
          "native": "Мы сидели на берегу реки."
        },
        {
          "context": "Walking along the water",
          "target": "Procházeli se podél říčního okraje.",
          "native": "Они гуляли вдоль кромки реки."
        },
        {
          "context": "Fishing spot",
          "target": "Stál na náplavce a chytal ryby.",
          "native": "Он стоял на набережной и ловил рыбу."
        }
      ],
      "expressionType": "literal",
      "equivalentNote": null,
      "usageNote": "Слово břeh является наиболее естественным и распространенным обозначением берега реки или ручья в чешском языке.",
      "alternatives": [
        {
          "text": "říční okraj",
          "synonyms": [
            {
              "text": "lem"
            }
          ]
        },
        {
          "text": "náplavka",
          "synonyms": [
            {
              "text": "nábřeží"
            }
          ]
        }
      ],
      "connotationWarning": null
    }
  }
}
```

Attempt 3:

```json
{
  "emoji": "🌊",
  "nativeMeaning": "Прибрежная полоса земли, непосредственно примыкающая к реке, озеру или другому водоему.",
  "sourceUsage": {
    "explanation": "Слово используется для обозначения полосы земли вдоль водоема. Важно не путать с финансовым учреждением. В контексте природы это нейтральный, общеупотребительный термин.",
    "synonyms": [
      {
        "text": "shore"
      },
      {
        "text": "riverside"
      }
    ],
    "examples": [
      {
        "context": "Sitting by the river",
        "target": "We sat on the bank of the river.",
        "native": "Мы сидели на берегу реки."
      },
      {
        "context": "Walking along the water",
        "target": "They walked along the shore for hours.",
        "native": "Они часами гуляли вдоль берега."
      },
      {
        "context": "Fishing spot",
        "target": "The riverside is perfect for fishing.",
        "native": "Берег реки идеально подходит для рыбалки."
      }
    ]
  },
  "nativeSynonyms": [
    {
      "text": "берег"
    },
    {
      "text": "побережье"
    }
  ],
  "translations": {
    "cs": {
      "text": "břeh",
      "synonyms": [
        {
          "text": "pobřeží"
        },
        {
          "text": "stráň"
        }
      ],
      "examples": [
        {
          "context": "Sitting by the river",
          "target": "Seděli jsme na břehu řeky.",
          "native": "Мы сидели на берегу реки."
        },
        {
          "context": "Walking along the water",
          "target": "Procházeli se dlouho po pobřeží.",
          "native": "Они долго гуляли по побережью."
        },
        {
          "context": "Steep slope",
          "target": "Ta stráň je příliš strmá.",
          "native": "Этот склон слишком крутой."
        }
      ],
      "expressionType": "literal",
      "equivalentNote": null,
      "usageNote": "Слово břeh является наиболее естественным и распространенным обозначением берега реки или ручья в чешском языке.",
      "alternatives": [
        {
          "text": "pobřeží",
          "synonyms": [
            {
              "text": "příbřeží"
            }
          ]
        },
        {
          "text": "stráň",
          "synonyms": [
            {
              "text": "svah"
            }
          ]
        }
      ],
      "connotationWarning": null
    }
  }
}
```

### polysemy-pitch-business

- Category: polysemy-with-context
- Input: pitch
- Source: en
- Targets: de
- Native language: cs
- Expected meaning: A concise persuasive presentation of an idea to investors.
- Quality risks: sports-field sense; sound-frequency sense; overly literal German
- Status: completed
- Duration: 7672 ms

```json
{
  "original": "pitch",
  "sourceLang": "en",
  "emoji": "🚀",
  "nativeMeaning": "Krátká, přesvědčivá prezentace podnikatelského záměru nebo nápadu, jejímž cílem je získat investory nebo obchodní partnery.",
  "sourceUsage": {
    "explanation": "Výraz se používá v obchodním prostředí pro označení cílené prezentace, která má za úkol prodat myšlenku nebo získat financování. Je to termín typický pro startupovou kulturu.",
    "synonyms": [
      {
        "text": "presentation"
      },
      {
        "text": "sales talk"
      },
      {
        "text": "proposal"
      }
    ],
    "examples": [
      {
        "context": "Startup founder presenting to investors",
        "target": "The founder delivered a compelling pitch to the venture capitalists.",
        "native": "Zakladatel přednesl investorům přesvědčivou prezentaci."
      },
      {
        "context": "Asking for a quick meeting",
        "target": "I need to give them my elevator speech before the meeting ends.",
        "native": "Musím jim stihnout přednést svůj stručný návrh, než schůzka skončí."
      },
      {
        "context": "Describing a new business idea",
        "target": "He spent all morning refining his project proposal for the board.",
        "native": "Celé dopoledne strávil pilováním svého návrhu projektu pro správní radu."
      }
    ]
  },
  "nativeSynonyms": [
    {
      "text": "prezentace"
    },
    {
      "text": "obchodní návrh"
    },
    {
      "text": "představení záměru"
    }
  ],
  "translations": {
    "de": {
      "text": "Präsentation",
      "synonyms": [
        {
          "text": "Vorstellung"
        },
        {
          "text": "Vortrag"
        }
      ],
      "examples": [
        {
          "context": "Startup founder presenting to investors",
          "target": "Der Gründer hielt eine überzeugende Präsentation vor den Investoren.",
          "native": "Zakladatel přednesl investorům přesvědčivou prezentaci."
        },
        {
          "context": "Short business summary",
          "target": "Er hat seinen Kurzvortrag für das Meeting vorbereitet.",
          "native": "Připravil si svůj krátký projev na schůzku."
        },
        {
          "context": "Proposing a new idea",
          "target": "Sie hat ihren Geschäftsvorschlag erfolgreich eingereicht.",
          "native": "Úspěšně předložila svůj obchodní návrh."
        }
      ],
      "expressionType": "literal",
      "equivalentNote": null,
      "usageNote": "V německém obchodním kontextu se často používá anglicismus 'Pitch', ale 'Präsentation' je formálnější a bezpečnější volba v konzervativnějším prostředí.",
      "alternatives": [
        {
          "text": "Kurzvortrag",
          "synonyms": [
            {
              "text": "Elevator Pitch"
            }
          ]
        },
        {
          "text": "Geschäftsvorschlag",
          "synonyms": [
            {
              "text": "Angebot"
            }
          ]
        }
      ],
      "connotationWarning": "Slovo 'Präsentation' je neutrální a profesionální, zatímco 'Pitch' v němčině zdůrazňuje dynamiku a prodejní charakter prezentace."
    }
  }
}
```

#### Raw attempts

Attempt 1:

```json
{
  "emoji": "🚀",
  "nativeMeaning": "Krátká, přesvědčivá prezentace podnikatelského záměru nebo nápadu určená potenciálním investorům.",
  "sourceUsage": {
    "explanation": "Výraz se používá v obchodním prostředí pro označení cílené prezentace, jejímž účelem je získat investici, prodat produkt nebo přesvědčit o nápadu. Má nádech profesionality a dynamiky.",
    "synonyms": [
      {
        "text": "presentation"
      },
      {
        "text": "proposal"
      }
    ],
    "examples": [
      {
        "context": "Founder presenting to investors",
        "target": "The founder delivered a compelling pitch to the board.",
        "native": "Zakladatel přednesl správní radě přesvědčivou prezentaci."
      },
      {
        "context": "Sales meeting",
        "target": "She gave a quick sales talk to the potential client.",
        "native": "Poskytla potenciálnímu klientovi rychlý obchodní výklad."
      },
      {
        "context": "Startup competition",
        "target": "His elevator speech impressed the judges.",
        "native": "Jeho krátké představení nápadu udělalo na porotce dojem."
      }
    ]
  },
  "nativeSynonyms": [
    {
      "text": "prezentace"
    },
    {
      "text": "obchodní nabídka"
    }
  ],
  "translations": {
    "de": {
      "text": "Pitch",
      "synonyms": [
        {
          "text": "Präsentation"
        },
        {
          "text": "Vorstellung"
        }
      ],
      "examples": [
        {
          "context": "Startup founder at a meeting",
          "target": "Der Gründer hielt einen überzeugenden Pitch vor den Investoren.",
          "native": "Zakladatel přednesl investorům přesvědčivou prezentaci."
        },
        {
          "context": "Business meeting",
          "target": "Sie präsentierte ihre Geschäftsidee sehr professionell.",
          "native": "Velmi profesionálně představila svůj podnikatelský záměr."
        },
        {
          "context": "Informal talk",
          "target": "Er gab einen kurzen Abriss seines Vorhabens.",
          "native": "Poskytl krátký nástin svého záměru."
        }
      ],
      "expressionType": "literal",
      "equivalentNote": null,
      "usageNote": "V německém startupovém prostředí se anglický výraz 'Pitch' běžně používá. Je to standardní termín v byznysu.",
      "alternatives": [
        {
          "text": "Geschäftspräsentation",
          "synonyms": [
            {
              "text": "Unternehmensvorstellung"
            }
          ]
        },
        {
          "text": "Kurzvorstellung",
          "synonyms": [
            {
              "text": "Abriss"
            }
          ]
        }
      ],
      "connotationWarning": "Výraz 'Pitch' zní velmi moderně a je typický pro startupovou scénu, v tradičnějších firmách může působit příliš neformálně."
    }
  }
}
```

Attempt 2:

```json
{
  "emoji": "🚀",
  "nativeMeaning": "Krátká, přesvědčivá prezentace podnikatelského záměru nebo nápadu, jejímž cílem je získat investory nebo obchodní partnery.",
  "sourceUsage": {
    "explanation": "Výraz se používá v obchodním prostředí pro označení cílené prezentace, která má za úkol prodat myšlenku nebo získat financování. Je to termín typický pro startupovou kulturu.",
    "synonyms": [
      {
        "text": "presentation"
      },
      {
        "text": "sales talk"
      },
      {
        "text": "proposal"
      }
    ],
    "examples": [
      {
        "context": "Startup founder presenting to investors",
        "target": "The founder delivered a compelling pitch to the venture capitalists.",
        "native": "Zakladatel přednesl investorům přesvědčivou prezentaci."
      },
      {
        "context": "Asking for a quick meeting",
        "target": "I need to give them my elevator speech before the meeting ends.",
        "native": "Musím jim stihnout přednést svůj stručný návrh, než schůzka skončí."
      },
      {
        "context": "Describing a new business idea",
        "target": "He spent all morning refining his project proposal for the board.",
        "native": "Celé dopoledne strávil pilováním svého návrhu projektu pro správní radu."
      }
    ]
  },
  "nativeSynonyms": [
    {
      "text": "prezentace"
    },
    {
      "text": "obchodní návrh"
    },
    {
      "text": "představení záměru"
    }
  ],
  "translations": {
    "de": {
      "text": "Präsentation",
      "synonyms": [
        {
          "text": "Vorstellung"
        },
        {
          "text": "Vortrag"
        }
      ],
      "examples": [
        {
          "context": "Startup founder presenting to investors",
          "target": "Der Gründer hielt eine überzeugende Präsentation vor den Investoren.",
          "native": "Zakladatel přednesl investorům přesvědčivou prezentaci."
        },
        {
          "context": "Short business summary",
          "target": "Er hat seinen Kurzvortrag für das Meeting vorbereitet.",
          "native": "Připravil si svůj krátký projev na schůzku."
        },
        {
          "context": "Proposing a new idea",
          "target": "Sie hat ihren Geschäftsvorschlag erfolgreich eingereicht.",
          "native": "Úspěšně předložila svůj obchodní návrh."
        }
      ],
      "expressionType": "literal",
      "equivalentNote": null,
      "usageNote": "V německém obchodním kontextu se často používá anglicismus 'Pitch', ale 'Präsentation' je formálnější a bezpečnější volba v konzervativnějším prostředí.",
      "alternatives": [
        {
          "text": "Kurzvortrag",
          "synonyms": [
            {
              "text": "Elevator Pitch"
            }
          ]
        },
        {
          "text": "Geschäftsvorschlag",
          "synonyms": [
            {
              "text": "Angebot"
            }
          ]
        }
      ],
      "connotationWarning": "Slovo 'Präsentation' je neutrální a profesionální, zatímco 'Pitch' v němčině zdůrazňuje dynamiku a prodejní charakter prezentace."
    }
  }
}
```

### idiom-break-a-leg

- Category: idiom
- Input: Break a leg!
- Source: en
- Targets: ru
- Native language: cs
- Expected meaning: A wish of good luck before a performance, not a literal injury.
- Quality risks: literal translation; incorrect register; failure to identify an idiomatic equivalent
- Status: completed
- Duration: 4019 ms

```json
{
  "original": "Break a leg!",
  "sourceLang": "en",
  "emoji": "🎭",
  "nativeMeaning": "Tradiční anglický idiom používaný v divadelním prostředí jako přání štěstí herci před vystoupením. Vychází z pověry, že přát štěstí přímo přivolává smůlu.",
  "sourceUsage": {
    "explanation": "Používá se výhradně v divadelním kontextu jako pověrčivý způsob, jak popřát úspěch. Nikdy nepoužívejte doslovný překlad, protože by to znělo jako přání zranění.",
    "synonyms": [
      {
        "text": "Good luck"
      },
      {
        "text": "Knock 'em dead"
      }
    ],
    "examples": [
      {
        "context": "Before the premiere",
        "target": "Break a leg out there tonight!",
        "native": "Zlom vaz, dnes večer to tam rozbal!"
      },
      {
        "context": "To a lead actor",
        "target": "Go knock 'em dead on that stage.",
        "native": "Jdi a ukaž jim, co v tobě je."
      },
      {
        "context": "Before the curtain rises",
        "target": "I wish you the best of luck with your performance.",
        "native": "Přeji ti hodně štěstí při tvém vystoupení."
      }
    ]
  },
  "nativeSynonyms": [
    {
      "text": "Zlom vaz"
    },
    {
      "text": "Hodně štěstí"
    }
  ],
  "translations": {
    "ru": {
      "text": "Ни пуха, ни пера!",
      "synonyms": [
        {
          "text": "Удачи"
        },
        {
          "text": "В добрый путь"
        }
      ],
      "examples": [
        {
          "context": "Before the show",
          "target": "Ни пуха, ни пера тебе на сцене!",
          "native": "Zlom vaz na tom jevišti!"
        },
        {
          "context": "To a colleague",
          "target": "Желаю тебе удачи в сегодняшнем спектакле.",
          "native": "Přeji ti hodně štěstí v dnešním představení."
        },
        {
          "context": "Encouragement",
          "target": "Пусть всё пройдёт успешно.",
          "native": "Ať vše proběhne úspěšně."
        }
      ],
      "expressionType": "idiomatic_equivalent",
      "equivalentNote": "Ruský idiom používaný pro přání štěstí před zkouškou nebo vystoupením, který stejně jako anglický originál využívá principu obráceného přání.",
      "usageNote": "Je to standardní a velmi přirozený způsob, jak popřát úspěch v ruském divadelním prostředí. Odpověď na toto přání je tradičně 'К чёрту!' (K čertu!).",
      "alternatives": [
        {
          "text": "Удачи!",
          "synonyms": [
            {
              "text": "Успехов"
            }
          ]
        },
        {
          "text": "Пусть всё получится!",
          "synonyms": [
            {
              "text": "Всё будет хорошо"
            }
          ]
        }
      ],
      "connotationWarning": "Při použití tohoto idiomu se očekává, že adresát odpoví 'К чёрту!' (K čertu!), jinak se věří, že přání nebude fungovat."
    }
  }
}
```

#### Raw attempts

Attempt 1:

```json
{
  "emoji": "🎭",
  "nativeMeaning": "Tradiční anglický idiom používaný v divadelním prostředí jako přání štěstí herci před vystoupením. Vychází z pověry, že přát štěstí přímo přivolává smůlu.",
  "sourceUsage": {
    "explanation": "Používá se výhradně v divadelním kontextu jako pověrčivý způsob, jak popřát úspěch. Nikdy nepoužívejte doslovný překlad, protože by to znělo jako přání zranění.",
    "synonyms": [
      {
        "text": "Good luck"
      },
      {
        "text": "Knock 'em dead"
      }
    ],
    "examples": [
      {
        "context": "Before the premiere",
        "target": "Break a leg out there tonight!",
        "native": "Zlom vaz, dnes večer to tam rozbal!"
      },
      {
        "context": "To a lead actor",
        "target": "Go knock 'em dead on that stage.",
        "native": "Jdi a ukaž jim, co v tobě je."
      },
      {
        "context": "Before the curtain rises",
        "target": "I wish you the best of luck with your performance.",
        "native": "Přeji ti hodně štěstí při tvém vystoupení."
      }
    ]
  },
  "nativeSynonyms": [
    {
      "text": "Zlom vaz"
    },
    {
      "text": "Hodně štěstí"
    }
  ],
  "translations": {
    "ru": {
      "text": "Ни пуха, ни пера!",
      "synonyms": [
        {
          "text": "Удачи"
        },
        {
          "text": "В добрый путь"
        }
      ],
      "examples": [
        {
          "context": "Before the show",
          "target": "Ни пуха, ни пера тебе на сцене!",
          "native": "Zlom vaz na tom jevišti!"
        },
        {
          "context": "To a colleague",
          "target": "Желаю тебе удачи в сегодняшнем спектакле.",
          "native": "Přeji ti hodně štěstí v dnešním představení."
        },
        {
          "context": "Encouragement",
          "target": "Пусть всё пройдёт успешно.",
          "native": "Ať vše proběhne úspěšně."
        }
      ],
      "expressionType": "idiomatic_equivalent",
      "equivalentNote": "Ruský idiom používaný pro přání štěstí před zkouškou nebo vystoupením, který stejně jako anglický originál využívá principu obráceného přání.",
      "usageNote": "Je to standardní a velmi přirozený způsob, jak popřát úspěch v ruském divadelním prostředí. Odpověď na toto přání je tradičně 'К чёрту!' (K čertu!).",
      "alternatives": [
        {
          "text": "Удачи!",
          "synonyms": [
            {
              "text": "Успехов"
            }
          ]
        },
        {
          "text": "Пусть всё получится!",
          "synonyms": [
            {
              "text": "Всё будет хорошо"
            }
          ]
        }
      ],
      "connotationWarning": "Při použití tohoto idiomu se očekává, že adresát odpoví 'К чёрту!' (K čertu!), jinak se věří, že přání nebude fungovat."
    }
  }
}
```

### idiom-delo-v-shlyape

- Category: idiom
- Input: Дело в шляпе
- Source: ru
- Targets: en
- Native language: ru
- Expected meaning: The matter is settled or success is practically assured.
- Quality risks: literal hat imagery; loss of confidence nuance; awkward English equivalent
- Status: completed
- Duration: 2925 ms

```json
{
  "original": "Дело в шляпе",
  "sourceLang": "ru",
  "emoji": "🎩",
  "nativeMeaning": "Выражение означает, что дело успешно завершено, договоренность достигнута или результат гарантирован.",
  "nativeSynonyms": [
    {
      "text": "Вопрос решен"
    },
    {
      "text": "Все схвачено"
    },
    {
      "text": "Дело сделано"
    }
  ],
  "translations": {
    "en": {
      "text": "It's in the bag",
      "synonyms": [
        {
          "text": "It's a done deal"
        },
        {
          "text": "It's a sure thing"
        }
      ],
      "examples": [
        {
          "context": "After signing the contract",
          "target": "Don't worry about the funding, it's in the bag.",
          "native": "Не волнуйся насчет финансирования, дело в шляпе."
        },
        {
          "context": "Confirming a successful negotiation",
          "target": "We shook hands on the price, so it's a done deal.",
          "native": "Мы ударили по рукам насчет цены, так что вопрос решен."
        },
        {
          "context": "Expressing confidence in an outcome",
          "target": "With the new partner on board, success is a sure thing.",
          "native": "С новым партнером в команде успех нам гарантирован."
        }
      ],
      "expressionType": "idiomatic_equivalent",
      "equivalentNote": "The English idiom 'in the bag' perfectly captures the sense of a guaranteed or finalized outcome common to the Russian phrase.",
      "usageNote": "Используется в разговорной речи для выражения уверенности в том, что результат уже обеспечен. Звучит неформально и оптимистично.",
      "alternatives": [
        {
          "text": "It's a done deal",
          "synonyms": [
            {
              "text": "Signed and sealed"
            }
          ]
        },
        {
          "text": "It's a sure thing",
          "synonyms": [
            {
              "text": "It's locked in"
            }
          ]
        }
      ],
      "connotationWarning": "Фраза звучит очень уверенно и может восприниматься как самоуверенная, если результат еще не окончательно подтвержден фактами."
    }
  }
}
```

#### Raw attempts

Attempt 1:

```json
{
  "emoji": "🎩",
  "nativeMeaning": "Выражение означает, что дело успешно завершено, договоренность достигнута или результат гарантирован.",
  "nativeSynonyms": [
    {
      "text": "Вопрос решен"
    },
    {
      "text": "Все схвачено"
    },
    {
      "text": "Дело сделано"
    }
  ],
  "translations": {
    "en": {
      "text": "It's in the bag",
      "synonyms": [
        {
          "text": "It's a done deal"
        },
        {
          "text": "It's a sure thing"
        }
      ],
      "examples": [
        {
          "context": "After signing the contract",
          "target": "Don't worry about the funding, it's in the bag.",
          "native": "Не волнуйся насчет финансирования, дело в шляпе."
        },
        {
          "context": "Confirming a successful negotiation",
          "target": "We shook hands on the price, so it's a done deal.",
          "native": "Мы ударили по рукам насчет цены, так что вопрос решен."
        },
        {
          "context": "Expressing confidence in an outcome",
          "target": "With the new partner on board, success is a sure thing.",
          "native": "С новым партнером в команде успех нам гарантирован."
        }
      ],
      "expressionType": "idiomatic_equivalent",
      "equivalentNote": "The English idiom 'in the bag' perfectly captures the sense of a guaranteed or finalized outcome common to the Russian phrase.",
      "usageNote": "Используется в разговорной речи для выражения уверенности в том, что результат уже обеспечен. Звучит неформально и оптимистично.",
      "alternatives": [
        {
          "text": "It's a done deal",
          "synonyms": [
            {
              "text": "Signed and sealed"
            }
          ]
        },
        {
          "text": "It's a sure thing",
          "synonyms": [
            {
              "text": "It's locked in"
            }
          ]
        }
      ],
      "connotationWarning": "Фраза звучит очень уверенно и может восприниматься как самоуверенная, если результат еще не окончательно подтвержден фактами."
    }
  }
}
```

### idiom-maslo-na-hlave

- Category: idiom
- Input: mít máslo na hlavě
- Source: cs
- Targets: en
- Native language: ru
- Expected meaning: Someone is not innocent and has something to feel guilty about.
- Quality risks: literal butter translation; wrong moral implication; missing idiom explanation
- Status: completed
- Duration: 4048 ms

```json
{
  "original": "mít máslo na hlavě",
  "sourceLang": "cs",
  "emoji": "🧈",
  "nativeMeaning": "Иметь собственные грехи или нечистую совесть, из-за чего критика других выглядит лицемерной.",
  "sourceUsage": {
    "explanation": "Идиома используется для описания человека, который критикует других, имея при этом собственные проступки или скелеты в шкафу. Это разговорное выражение, часто употребляемое с оттенком иронии или упрека в лицемерии.",
    "synonyms": [
      {
        "text": "mít máslo na hlavě"
      },
      {
        "text": "mít černé svědomí"
      },
      {
        "text": "nebýt bez viny"
      }
    ],
    "examples": [
      {
        "context": "Kritika kolegy",
        "target": "Neměl bys kritizovat ostatní, když máš sám máslo na hlavě.",
        "native": "Тебе не стоит критиковать других, когда у самого рыльце в пушку."
      },
      {
        "context": "Politická debata",
        "target": "Politik se snaží útočit na soupeře, i když má sám černé svědomí.",
        "native": "Политик пытается атаковать соперника, хотя у самого совесть нечиста."
      },
      {
        "context": "Rodinný spor",
        "target": "Než začneš soudit mé chyby, uvědom si, že nejsi bez viny.",
        "native": "Прежде чем судить мои ошибки, осознай, что сам не без греха."
      }
    ]
  },
  "nativeSynonyms": [
    {
      "text": "рыльце в пушку"
    },
    {
      "text": "бревно в глазу"
    },
    {
      "text": "сам не без греха"
    }
  ],
  "translations": {
    "en": {
      "text": "to have a skeleton in the closet",
      "synonyms": [
        {
          "text": "to have a guilty conscience"
        },
        {
          "text": "to be a hypocrite"
        }
      ],
      "examples": [
        {
          "context": "Professional criticism",
          "target": "He shouldn't judge others when he has skeletons in his own closet.",
          "native": "Ему не стоит судить других, когда у самого рыльце в пушку."
        },
        {
          "context": "Pointing out hypocrisy",
          "target": "It's rich coming from him, considering he lives in a glass house.",
          "native": "Смешно слышать это от него, учитывая, что он сам не без греха."
        },
        {
          "context": "Workplace conflict",
          "target": "She is the last person who should talk, given that she is not without sin herself.",
          "native": "Она последний человек, кому стоит об этом говорить, учитывая, что сама не без греха."
        }
      ],
      "expressionType": "idiomatic_equivalent",
      "equivalentNote": "The idiom 'skeleton in the closet' or 'living in a glass house' captures the nuance of having hidden faults while criticizing others.",
      "usageNote": "Используется в разговорной речи для указания на лицемерие. 'Living in a glass house' особенно подходит, когда кто-то критикует других за то же самое, в чем виноват сам.",
      "alternatives": [
        {
          "text": "to live in a glass house",
          "synonyms": [
            {
              "text": "to be a hypocrite"
            }
          ]
        },
        {
          "text": "to be not without sin",
          "synonyms": [
            {
              "text": "to be guilty"
            }
          ]
        }
      ],
      "connotationWarning": "Выражение 'living in a glass house' подразумевает, что человек уязвим для ответной критики из-за своих собственных проступков."
    }
  }
}
```

#### Raw attempts

Attempt 1:

```json
{
  "emoji": "🧈",
  "nativeMeaning": "Иметь собственные грехи или нечистую совесть, из-за чего критика других выглядит лицемерной.",
  "sourceUsage": {
    "explanation": "Идиома используется для описания человека, который критикует других, имея при этом собственные проступки или скелеты в шкафу. Это разговорное выражение, часто употребляемое с оттенком иронии или упрека в лицемерии.",
    "synonyms": [
      {
        "text": "mít máslo na hlavě"
      },
      {
        "text": "mít černé svědomí"
      },
      {
        "text": "nebýt bez viny"
      }
    ],
    "examples": [
      {
        "context": "Kritika kolegy",
        "target": "Neměl bys kritizovat ostatní, když máš sám máslo na hlavě.",
        "native": "Тебе не стоит критиковать других, когда у самого рыльце в пушку."
      },
      {
        "context": "Politická debata",
        "target": "Politik se snaží útočit na soupeře, i když má sám černé svědomí.",
        "native": "Политик пытается атаковать соперника, хотя у самого совесть нечиста."
      },
      {
        "context": "Rodinný spor",
        "target": "Než začneš soudit mé chyby, uvědom si, že nejsi bez viny.",
        "native": "Прежде чем судить мои ошибки, осознай, что сам не без греха."
      }
    ]
  },
  "nativeSynonyms": [
    {
      "text": "рыльце в пушку"
    },
    {
      "text": "бревно в глазу"
    },
    {
      "text": "сам не без греха"
    }
  ],
  "translations": {
    "en": {
      "text": "to have a skeleton in the closet",
      "synonyms": [
        {
          "text": "to have a guilty conscience"
        },
        {
          "text": "to be a hypocrite"
        }
      ],
      "examples": [
        {
          "context": "Professional criticism",
          "target": "He shouldn't judge others when he has skeletons in his own closet.",
          "native": "Ему не стоит судить других, когда у самого рыльце в пушку."
        },
        {
          "context": "Pointing out hypocrisy",
          "target": "It's rich coming from him, considering he lives in a glass house.",
          "native": "Смешно слышать это от него, учитывая, что он сам не без греха."
        },
        {
          "context": "Workplace conflict",
          "target": "She is the last person who should talk, given that she is not without sin herself.",
          "native": "Она последний человек, кому стоит об этом говорить, учитывая, что сама не без греха."
        }
      ],
      "expressionType": "idiomatic_equivalent",
      "equivalentNote": "The idiom 'skeleton in the closet' or 'living in a glass house' captures the nuance of having hidden faults while criticizing others.",
      "usageNote": "Используется в разговорной речи для указания на лицемерие. 'Living in a glass house' особенно подходит, когда кто-то критикует других за то же самое, в чем виноват сам.",
      "alternatives": [
        {
          "text": "to live in a glass house",
          "synonyms": [
            {
              "text": "to be a hypocrite"
            }
          ]
        },
        {
          "text": "to be not without sin",
          "synonyms": [
            {
              "text": "to be guilty"
            }
          ]
        }
      ],
      "connotationWarning": "Выражение 'living in a glass house' подразумевает, что человек уязвим для ответной критики из-за своих собственных проступков."
    }
  }
}
```

### slang-lit-party

- Category: slang
- Input: That party was lit.
- Source: en
- Targets: cs
- Native language: ru
- Expected meaning: The party was exciting, lively, and very enjoyable.
- Quality risks: literal fire meaning; dated slang; register mismatch
- Status: completed
- Duration: 3612 ms

```json
{
  "original": "That party was lit.",
  "sourceLang": "en",
  "emoji": "🔥",
  "nativeMeaning": "Выражение, описывающее вечеринку как очень веселую, энергичную и запоминающуюся.",
  "sourceUsage": {
    "explanation": "Сленговое выражение, означающее, что мероприятие прошло отлично, было очень драйвовым и интересным. Используется в неформальном общении между друзьями. Не стоит употреблять в официальной обстановке.",
    "synonyms": [
      {
        "text": "That party was amazing"
      },
      {
        "text": "That party was epic"
      }
    ],
    "examples": [
      {
        "context": "Talking about last night",
        "target": "That party was lit.",
        "native": "Та вечеринка была просто огонь."
      },
      {
        "context": "Describing the energy",
        "target": "That party was fire.",
        "native": "Та вечеринка была пушка."
      },
      {
        "context": "Recalling the vibe",
        "target": "That party was wild.",
        "native": "Та вечеринка была безумной."
      }
    ]
  },
  "nativeSynonyms": [
    {
      "text": "Вечеринка была огонь"
    },
    {
      "text": "Вечеринка была пушка"
    }
  ],
  "translations": {
    "cs": {
      "text": "Ta párty byla totální pecka.",
      "synonyms": [
        {
          "text": "Ta párty byla super"
        },
        {
          "text": "Ta párty byla nářez"
        }
      ],
      "examples": [
        {
          "context": "Talking about last night",
          "target": "Ta párty byla totální pecka.",
          "native": "Та вечеринка была просто огонь."
        },
        {
          "context": "Describing the energy",
          "target": "Ta párty byla fakt nářez.",
          "native": "Та вечеринка была очень драйвовой."
        },
        {
          "context": "Recalling the vibe",
          "target": "Ta párty byla naprostá bomba.",
          "native": "Та вечеринка была просто бомба."
        }
      ],
      "expressionType": "idiomatic_equivalent",
      "equivalentNote": "Использование сленгового слова 'pecka' идеально передает эмоциональный окрас английского 'lit' в молодежной среде.",
      "usageNote": "Это очень неформальное выражение, подходящее для общения с близкими друзьями. В официальных ситуациях лучше использовать 'Ta párty byla skvělá'.",
      "alternatives": [
        {
          "text": "Ta párty byla nářez.",
          "synonyms": [
            {
              "text": "hustý"
            }
          ]
        },
        {
          "text": "Ta párty byla bomba.",
          "synonyms": [
            {
              "text": "super"
            }
          ]
        }
      ],
      "connotationWarning": "Слово 'pecka' является ярко выраженным молодежным сленгом, поэтому его использование ограничено неформальным контекстом."
    }
  }
}
```

#### Raw attempts

Attempt 1:

```json
{
  "emoji": "🔥",
  "nativeMeaning": "Выражение, описывающее вечеринку как очень веселую, энергичную и запоминающуюся.",
  "sourceUsage": {
    "explanation": "Сленговое выражение, означающее, что мероприятие прошло отлично, было очень драйвовым и интересным. Используется в неформальном общении между друзьями. Не стоит употреблять в официальной обстановке.",
    "synonyms": [
      {
        "text": "That party was amazing"
      },
      {
        "text": "That party was epic"
      }
    ],
    "examples": [
      {
        "context": "Talking about last night",
        "target": "That party was lit.",
        "native": "Та вечеринка была просто огонь."
      },
      {
        "context": "Describing the energy",
        "target": "That party was fire.",
        "native": "Та вечеринка была пушка."
      },
      {
        "context": "Recalling the vibe",
        "target": "That party was wild.",
        "native": "Та вечеринка была безумной."
      }
    ]
  },
  "nativeSynonyms": [
    {
      "text": "Вечеринка была огонь"
    },
    {
      "text": "Вечеринка была пушка"
    }
  ],
  "translations": {
    "cs": {
      "text": "Ta párty byla totální pecka.",
      "synonyms": [
        {
          "text": "Ta párty byla super"
        },
        {
          "text": "Ta párty byla nářez"
        }
      ],
      "examples": [
        {
          "context": "Talking about last night",
          "target": "Ta párty byla totální pecka.",
          "native": "Та вечеринка была просто огонь."
        },
        {
          "context": "Describing the energy",
          "target": "Ta párty byla fakt nářez.",
          "native": "Та вечеринка была очень драйвовой."
        },
        {
          "context": "Recalling the vibe",
          "target": "Ta párty byla naprostá bomba.",
          "native": "Та вечеринка была просто бомба."
        }
      ],
      "expressionType": "idiomatic_equivalent",
      "equivalentNote": "Использование сленгового слова 'pecka' идеально передает эмоциональный окрас английского 'lit' в молодежной среде.",
      "usageNote": "Это очень неформальное выражение, подходящее для общения с близкими друзьями. В официальных ситуациях лучше использовать 'Ta párty byla skvělá'.",
      "alternatives": [
        {
          "text": "Ta párty byla nářez.",
          "synonyms": [
            {
              "text": "hustý"
            }
          ]
        },
        {
          "text": "Ta párty byla bomba.",
          "synonyms": [
            {
              "text": "super"
            }
          ]
        }
      ],
      "connotationWarning": "Слово 'pecka' является ярко выраженным молодежным сленгом, поэтому его использование ограничено неформальным контекстом."
    }
  }
}
```

### slang-zaskamil

- Category: borrowed-slang
- Input: Он меня заскамил
- Source: ru
- Targets: en
- Native language: ru
- Expected meaning: He scammed or deceived me, expressed informally.
- Quality risks: unexplained transliteration; overly formal English; loss of online-slang register
- Status: completed
- Duration: 2989 ms

```json
{
  "original": "Он меня заскамил",
  "sourceLang": "ru",
  "emoji": "💸",
  "nativeMeaning": "Ситуация, когда кто-то обманул человека в сделке, обычно связанной с деньгами, криптовалютой или онлайн-покупками.",
  "nativeSynonyms": [
    {
      "text": "Он меня кинул"
    },
    {
      "text": "Он меня обманул"
    },
    {
      "text": "Он меня развел"
    }
  ],
  "translations": {
    "en": {
      "text": "He scammed me",
      "synonyms": [
        {
          "text": "He ripped me off"
        },
        {
          "text": "He defrauded me"
        }
      ],
      "examples": [
        {
          "context": "Losing money in a fake trade",
          "target": "He scammed me out of my savings.",
          "native": "Он выманил у меня все сбережения."
        },
        {
          "context": "Buying a fake product online",
          "target": "That seller totally ripped me off.",
          "native": "Этот продавец меня конкретно кинул."
        },
        {
          "context": "Being tricked by a fake link",
          "target": "I think I just got swindled by a fake website.",
          "native": "Кажется, меня только что развели на поддельном сайте."
        }
      ],
      "expressionType": "idiomatic_equivalent",
      "equivalentNote": "Scam is a direct loanword in modern Russian slang, but 'ripped off' or 'swindled' are the most natural English equivalents for financial deception.",
      "usageNote": "Используется в неформальном общении для описания мошенничества. 'Scammed' — самый популярный вариант в интернет-среде, 'ripped off' чаще применяется к завышенным ценам или некачественным товарам.",
      "alternatives": [
        {
          "text": "He ripped me off",
          "synonyms": [
            {
              "text": "He fleeced me"
            }
          ]
        },
        {
          "text": "He swindled me",
          "synonyms": [
            {
              "text": "He conned me"
            }
          ]
        }
      ],
      "connotationWarning": "Слово 'scammed' имеет ярко выраженный оттенок интернет-мошенничества, в то время как 'swindled' звучит более формально или классически."
    }
  }
}
```

#### Raw attempts

Attempt 1:

```json
{
  "emoji": "💸",
  "nativeMeaning": "Ситуация, когда кто-то обманул человека в сделке, обычно связанной с деньгами, криптовалютой или онлайн-покупками.",
  "nativeSynonyms": [
    {
      "text": "Он меня кинул"
    },
    {
      "text": "Он меня обманул"
    },
    {
      "text": "Он меня развел"
    }
  ],
  "translations": {
    "en": {
      "text": "He scammed me",
      "synonyms": [
        {
          "text": "He ripped me off"
        },
        {
          "text": "He defrauded me"
        }
      ],
      "examples": [
        {
          "context": "Losing money in a fake trade",
          "target": "He scammed me out of my savings.",
          "native": "Он выманил у меня все сбережения."
        },
        {
          "context": "Buying a fake product online",
          "target": "That seller totally ripped me off.",
          "native": "Этот продавец меня конкретно кинул."
        },
        {
          "context": "Being tricked by a fake link",
          "target": "I think I just got swindled by a fake website.",
          "native": "Кажется, меня только что развели на поддельном сайте."
        }
      ],
      "expressionType": "idiomatic_equivalent",
      "equivalentNote": "Scam is a direct loanword in modern Russian slang, but 'ripped off' or 'swindled' are the most natural English equivalents for financial deception.",
      "usageNote": "Используется в неформальном общении для описания мошенничества. 'Scammed' — самый популярный вариант в интернет-среде, 'ripped off' чаще применяется к завышенным ценам или некачественным товарам.",
      "alternatives": [
        {
          "text": "He ripped me off",
          "synonyms": [
            {
              "text": "He fleeced me"
            }
          ]
        },
        {
          "text": "He swindled me",
          "synonyms": [
            {
              "text": "He conned me"
            }
          ]
        }
      ],
      "connotationWarning": "Слово 'scammed' имеет ярко выраженный оттенок интернет-мошенничества, в то время как 'swindled' звучит более формально или классически."
    }
  }
}
```

### slang-to-je-husty

- Category: regional-colloquialism
- Input: To je hustý!
- Source: cs
- Targets: en
- Native language: ru
- Expected meaning: An impressed reaction meaning that something is amazing or intense.
- Quality risks: literal density meaning; wrong positive/negative polarity; unnatural English slang
- Status: completed
- Duration: 3367 ms

```json
{
  "original": "To je hustý!",
  "sourceLang": "cs",
  "emoji": "🔥",
  "nativeMeaning": "Разговорное выражение, означающее, что что-то очень крутое, впечатляющее или удивительное.",
  "sourceUsage": {
    "explanation": "Это сленговое выражение, используемое для выражения восторга или одобрения. Оно очень популярно среди молодежи. Его стоит использовать в неформальной обстановке с друзьями, но избегать в официальных ситуациях.",
    "synonyms": [
      {
        "text": "To je pecka"
      },
      {
        "text": "To je super"
      }
    ],
    "examples": [
      {
        "context": "Реакция на крутой трюк",
        "target": "To je hustý!",
        "native": "Это круто!"
      },
      {
        "context": "Реакция на отличную новость",
        "target": "To je pecka!",
        "native": "Это просто бомба!"
      },
      {
        "context": "Реакция на классный подарок",
        "target": "To je super!",
        "native": "Это супер!"
      }
    ]
  },
  "nativeSynonyms": [
    {
      "text": "Круто"
    },
    {
      "text": "Класс"
    },
    {
      "text": "Офигенно"
    }
  ],
  "translations": {
    "en": {
      "text": "That's sick!",
      "synonyms": [
        {
          "text": "That's awesome"
        },
        {
          "text": "That's cool"
        }
      ],
      "examples": [
        {
          "context": "Реакция на трюк",
          "target": "That's sick!",
          "native": "Это круто!"
        },
        {
          "context": "Реакция на успех",
          "target": "That's awesome!",
          "native": "Это потрясающе!"
        },
        {
          "context": "Реакция на крутую вещь",
          "target": "That's cool!",
          "native": "Это классно!"
        }
      ],
      "expressionType": "idiomatic_equivalent",
      "equivalentNote": "Используется сленговое слово 'sick', которое в молодежном контексте означает высшую степень одобрения.",
      "usageNote": "Это очень неформальное выражение. Используйте его только с близкими друзьями. В профессиональной среде оно будет звучать неуместно.",
      "alternatives": [
        {
          "text": "That's awesome!",
          "synonyms": [
            {
              "text": "Amazing"
            }
          ]
        },
        {
          "text": "That's cool!",
          "synonyms": [
            {
              "text": "Great"
            }
          ]
        }
      ],
      "connotationWarning": "Слово 'sick' может быть непонятно старшему поколению и звучит исключительно как молодежный сленг."
    }
  }
}
```

#### Raw attempts

Attempt 1:

```json
{
  "emoji": "🔥",
  "nativeMeaning": "Разговорное выражение, означающее, что что-то очень крутое, впечатляющее или удивительное.",
  "sourceUsage": {
    "explanation": "Это сленговое выражение, используемое для выражения восторга или одобрения. Оно очень популярно среди молодежи. Его стоит использовать в неформальной обстановке с друзьями, но избегать в официальных ситуациях.",
    "synonyms": [
      {
        "text": "To je pecka"
      },
      {
        "text": "To je super"
      }
    ],
    "examples": [
      {
        "context": "Реакция на крутой трюк",
        "target": "To je hustý!",
        "native": "Это круто!"
      },
      {
        "context": "Реакция на отличную новость",
        "target": "To je pecka!",
        "native": "Это просто бомба!"
      },
      {
        "context": "Реакция на классный подарок",
        "target": "To je super!",
        "native": "Это супер!"
      }
    ]
  },
  "nativeSynonyms": [
    {
      "text": "Круто"
    },
    {
      "text": "Класс"
    },
    {
      "text": "Офигенно"
    }
  ],
  "translations": {
    "en": {
      "text": "That's sick!",
      "synonyms": [
        {
          "text": "That's awesome"
        },
        {
          "text": "That's cool"
        }
      ],
      "examples": [
        {
          "context": "Реакция на трюк",
          "target": "That's sick!",
          "native": "Это круто!"
        },
        {
          "context": "Реакция на успех",
          "target": "That's awesome!",
          "native": "Это потрясающе!"
        },
        {
          "context": "Реакция на крутую вещь",
          "target": "That's cool!",
          "native": "Это классно!"
        }
      ],
      "expressionType": "idiomatic_equivalent",
      "equivalentNote": "Используется сленговое слово 'sick', которое в молодежном контексте означает высшую степень одобрения.",
      "usageNote": "Это очень неформальное выражение. Используйте его только с близкими друзьями. В профессиональной среде оно будет звучать неуместно.",
      "alternatives": [
        {
          "text": "That's awesome!",
          "synonyms": [
            {
              "text": "Amazing"
            }
          ]
        },
        {
          "text": "That's cool!",
          "synonyms": [
            {
              "text": "Great"
            }
          ]
        }
      ],
      "connotationWarning": "Слово 'sick' может быть непонятно старшему поколению и звучит исключительно как молодежный сленг."
    }
  }
}
```

### phrasal-verb-phase-out

- Category: phrasal-verb
- Input: phase out
- Source: en
- Targets: cs, ru
- Native language: ru
- Expected meaning: To discontinue something gradually rather than stop it immediately.
- Quality risks: loss of graduality; same wording copied across languages; unnatural aspect choice
- Status: completed
- Duration: 7384 ms

```json
{
  "original": "phase out",
  "sourceLang": "en",
  "emoji": "📉",
  "nativeMeaning": "Постепенное прекращение использования, поддержки или производства чего-либо в течение определенного периода времени.",
  "sourceUsage": {
    "explanation": "Используется для описания процесса, при котором что-то выводится из эксплуатации или обращения поэтапно, а не мгновенно. Часто применяется в бизнесе и технологиях.",
    "synonyms": [
      {
        "text": "gradually discontinue"
      },
      {
        "text": "wind down"
      },
      {
        "text": "sunset"
      }
    ],
    "examples": [
      {
        "context": "Business strategy",
        "target": "The company will phase out the old software by next year.",
        "native": "Компания постепенно прекратит поддержку старого программного обеспечения к следующему году."
      },
      {
        "context": "Manufacturing",
        "target": "They decided to gradually discontinue the production of these outdated models.",
        "native": "Они решили постепенно прекратить производство этих устаревших моделей."
      },
      {
        "context": "Policy change",
        "target": "The government plans to wind down subsidies for fossil fuels.",
        "native": "Правительство планирует постепенно свернуть субсидии на ископаемое топливо."
      }
    ]
  },
  "nativeSynonyms": [
    {
      "text": "постепенно выводить из эксплуатации"
    },
    {
      "text": "поэтапно прекращать"
    },
    {
      "text": "сворачивать"
    }
  ],
  "translations": {
    "cs": {
      "text": "postupně vyřadit",
      "synonyms": [
        {
          "text": "utlumit"
        },
        {
          "text": "postupně ukončit"
        }
      ],
      "examples": [
        {
          "context": "Product support",
          "target": "Firma plánuje postupně vyřadit starou verzi produktu.",
          "native": "Компания планирует постепенно вывести из эксплуатации старую версию продукта."
        },
        {
          "context": "Production",
          "target": "Výroba těchto součástek bude brzy utlumena.",
          "native": "Производство этих компонентов скоро будет постепенно свернуто."
        },
        {
          "context": "Service",
          "target": "Službu chceme postupně ukončit do konce roku.",
          "native": "Мы хотим постепенно прекратить предоставление этой услуги до конца года."
        }
      ],
      "expressionType": "literal",
      "equivalentNote": "Přímý překlad odpovídá významu v obchodním kontextu.",
      "usageNote": "Используется в формальном и деловом контексте, когда речь идет о планомерном процессе завершения чего-либо.",
      "alternatives": [
        {
          "text": "utlumit",
          "synonyms": [
            {
              "text": "omezit"
            }
          ]
        },
        {
          "text": "postupně ukončit",
          "synonyms": [
            {
              "text": "zastavit"
            }
          ]
        }
      ],
      "connotationWarning": "Слово utlumit звучит более официально и часто используется в контексте производства или государственных программ."
    },
    "ru": {
      "text": "постепенно выводить из эксплуатации",
      "synonyms": [
        {
          "text": "поэтапно прекращать"
        },
        {
          "text": "сворачивать"
        }
      ],
      "examples": [],
      "alternatives": null,
      "expressionType": null,
      "equivalentNote": null,
      "usageNote": null,
      "connotationWarning": null
    }
  }
}
```

#### Raw attempts

Attempt 1:

```json
{
  "emoji": "📉",
  "nativeMeaning": "Постепенное прекращение использования, поддержки или производства чего-либо в течение определенного периода времени.",
  "sourceUsage": {
    "explanation": "Фразовый глагол, используемый для описания процесса постепенного вывода из эксплуатации, прекращения поддержки продукта или отказа от практики. Звучит официально и профессионально, часто используется в бизнес-контексте.",
    "synonyms": [
      {
        "text": "gradually discontinue"
      },
      {
        "text": "wind down"
      }
    ],
    "examples": [
      {
        "context": "Компания прекращает поддержку старой версии ПО.",
        "target": "The company will phase out the legacy software by next year.",
        "native": "Компания постепенно прекратит поддержку устаревшего ПО к следующему году."
      },
      {
        "context": "Производитель сворачивает выпуск устаревших моделей.",
        "target": "They decided to discontinue the production of older models.",
        "native": "Они решили прекратить производство старых моделей."
      },
      {
        "context": "Завод постепенно закрывает нерентабельные линии.",
        "target": "The factory is winding down its inefficient production lines.",
        "native": "Завод постепенно сворачивает свои неэффективные производственные линии."
      }
    ]
  },
  "nativeSynonyms": [
    {
      "text": "постепенно прекращать"
    },
    {
      "text": "сворачивать"
    },
    {
      "text": "выводить из обращения"
    }
  ],
  "translations": {
    "cs": {
      "text": "postupně ukončit",
      "synonyms": [
        {
          "text": "utlumit"
        },
        {
          "text": "vyřadit"
        }
      ],
      "examples": [
        {
          "context": "Firma postupně ukončí podporu starého systému.",
          "target": "Společnost postupně ukončí podporu starého systému.",
          "native": "Компания постепенно прекратит поддержку старой системы."
        },
        {
          "context": "Výrobce utlumí výrobu zastaralých modelů.",
          "target": "Výrobce utlumí výrobu zastaralých modelů.",
          "native": "Производитель постепенно свернет производство устаревших моделей."
        },
        {
          "context": "Musíme vyřadit tyto staré stroje z provozu.",
          "target": "Musíme vyřadit tyto staré stroje z provozu.",
          "native": "Мы должны вывести из эксплуатации эти старые станки."
        }
      ],
      "expressionType": "literal",
      "equivalentNote": null,
      "usageNote": "Používá se v obchodním a technickém kontextu pro proces, který probíhá v několika fázích, nikoliv náhle.",
      "alternatives": [
        {
          "text": "utlumit",
          "synonyms": [
            {
              "text": "omezit"
            }
          ]
        },
        {
          "text": "vyřadit z provozu",
          "synonyms": [
            {
              "text": "odstavit"
            }
          ]
        }
      ],
      "connotationWarning": "Působí profesionálně a neutrálně, vhodné pro korporátní komunikaci."
    },
    "ru": {
      "text": "постепенно прекращать",
      "synonyms": [
        {
          "text": "сворачивать"
        },
        {
          "text": "выводить из эксплуатации"
        }
      ]
    }
  }
}
```

Attempt 2:

```json
{
  "emoji": "📉",
  "nativeMeaning": "Постепенное прекращение использования, поддержки или производства чего-либо в течение определенного периода времени.",
  "sourceUsage": {
    "explanation": "Используется для описания процесса, при котором что-то выводится из эксплуатации или обращения поэтапно, а не мгновенно. Часто применяется в бизнесе и технологиях.",
    "synonyms": [
      {
        "text": "gradually discontinue"
      },
      {
        "text": "wind down"
      },
      {
        "text": "sunset"
      }
    ],
    "examples": [
      {
        "context": "Business strategy",
        "target": "The company will phase out the old software by next year.",
        "native": "Компания постепенно прекратит поддержку старого программного обеспечения к следующему году."
      },
      {
        "context": "Manufacturing",
        "target": "They decided to gradually discontinue the production of these outdated models.",
        "native": "Они решили постепенно прекратить производство этих устаревших моделей."
      },
      {
        "context": "Policy change",
        "target": "The government plans to wind down subsidies for fossil fuels.",
        "native": "Правительство планирует постепенно свернуть субсидии на ископаемое топливо."
      }
    ]
  },
  "nativeSynonyms": [
    {
      "text": "постепенно выводить из эксплуатации"
    },
    {
      "text": "поэтапно прекращать"
    },
    {
      "text": "сворачивать"
    }
  ],
  "translations": {
    "cs": {
      "text": "postupně vyřadit",
      "synonyms": [
        {
          "text": "utlumit"
        },
        {
          "text": "postupně ukončit"
        }
      ],
      "examples": [
        {
          "context": "Product support",
          "target": "Firma plánuje postupně vyřadit starou verzi produktu.",
          "native": "Компания планирует постепенно вывести из эксплуатации старую версию продукта."
        },
        {
          "context": "Production",
          "target": "Výroba těchto součástek bude brzy utlumena.",
          "native": "Производство этих компонентов скоро будет постепенно свернуто."
        },
        {
          "context": "Service",
          "target": "Službu chceme postupně ukončit do konce roku.",
          "native": "Мы хотим постепенно прекратить предоставление этой услуги до конца года."
        }
      ],
      "expressionType": "literal",
      "equivalentNote": "Přímý překlad odpovídá významu v obchodním kontextu.",
      "usageNote": "Используется в формальном и деловом контексте, когда речь идет о планомерном процессе завершения чего-либо.",
      "alternatives": [
        {
          "text": "utlumit",
          "synonyms": [
            {
              "text": "omezit"
            }
          ]
        },
        {
          "text": "postupně ukončit",
          "synonyms": [
            {
              "text": "zastavit"
            }
          ]
        }
      ],
      "connotationWarning": "Слово utlumit звучит более официально и часто используется в контексте производства или государственных программ."
    },
    "ru": {
      "text": "постепенно выводить из эксплуатации",
      "synonyms": [
        {
          "text": "поэтапно прекращать"
        },
        {
          "text": "сворачивать"
        }
      ]
    }
  }
}
```

### false-friend-magazin

- Category: false-friend
- Input: магазин
- Source: ru
- Targets: en
- Native language: ru
- Expected meaning: A shop or store, never a periodical magazine in this context.
- Quality risks: false cognate; missing usage warning; incorrect examples
- Status: completed
- Duration: 2603 ms

```json
{
  "original": "магазин",
  "sourceLang": "ru",
  "emoji": "🛒",
  "nativeMeaning": "Место, где продаются продукты питания и товары повседневного спроса.",
  "nativeSynonyms": [
    {
      "text": "лавка"
    },
    {
      "text": "супермаркет"
    },
    {
      "text": "гастроном"
    }
  ],
  "translations": {
    "en": {
      "text": "grocery store",
      "synonyms": [
        {
          "text": "supermarket"
        },
        {
          "text": "food store"
        }
      ],
      "examples": [
        {
          "context": "Buying food",
          "target": "I need to go to the grocery store to buy some milk.",
          "native": "Мне нужно сходить в магазин, чтобы купить молока."
        },
        {
          "context": "Weekly shopping",
          "target": "We usually do our weekly shopping at the local supermarket.",
          "native": "Мы обычно закупаемся продуктами на неделю в местном супермаркете."
        },
        {
          "context": "Small shop",
          "target": "There is a small food store around the corner.",
          "native": "За углом есть небольшой продуктовый магазинчик."
        }
      ],
      "expressionType": "literal",
      "equivalentNote": null,
      "usageNote": "Grocery store — самый распространенный термин в США для обозначения места покупки продуктов. В Великобритании чаще говорят shop или supermarket.",
      "alternatives": [
        {
          "text": "supermarket",
          "synonyms": [
            {
              "text": "chain store"
            }
          ]
        },
        {
          "text": "food store",
          "synonyms": [
            {
              "text": "corner shop"
            }
          ]
        }
      ],
      "connotationWarning": null
    }
  }
}
```

#### Raw attempts

Attempt 1:

```json
{
  "emoji": "🛒",
  "nativeMeaning": "Место, где продаются продукты питания и товары повседневного спроса.",
  "nativeSynonyms": [
    {
      "text": "лавка"
    },
    {
      "text": "супермаркет"
    },
    {
      "text": "гастроном"
    }
  ],
  "translations": {
    "en": {
      "text": "grocery store",
      "synonyms": [
        {
          "text": "supermarket"
        },
        {
          "text": "food store"
        }
      ],
      "examples": [
        {
          "context": "Buying food",
          "target": "I need to go to the grocery store to buy some milk.",
          "native": "Мне нужно сходить в магазин, чтобы купить молока."
        },
        {
          "context": "Weekly shopping",
          "target": "We usually do our weekly shopping at the local supermarket.",
          "native": "Мы обычно закупаемся продуктами на неделю в местном супермаркете."
        },
        {
          "context": "Small shop",
          "target": "There is a small food store around the corner.",
          "native": "За углом есть небольшой продуктовый магазинчик."
        }
      ],
      "expressionType": "literal",
      "equivalentNote": null,
      "usageNote": "Grocery store — самый распространенный термин в США для обозначения места покупки продуктов. В Великобритании чаще говорят shop или supermarket.",
      "alternatives": [
        {
          "text": "supermarket",
          "synonyms": [
            {
              "text": "chain store"
            }
          ]
        },
        {
          "text": "food store",
          "synonyms": [
            {
              "text": "corner shop"
            }
          ]
        }
      ],
      "connotationWarning": null
    }
  }
}
```

### formal-german-request

- Category: formal-register
- Input: Wären Sie so freundlich, mir die Unterlagen bis Freitag zukommen zu lassen?
- Source: de
- Targets: en
- Native language: ru
- Expected meaning: A courteous request to send the documents by Friday.
- Quality risks: loss of politeness; incorrect deadline relation; overly casual English
- Status: completed
- Duration: 1305 ms

```json
{
  "original": "Wären Sie so freundlich, mir die Unterlagen bis Freitag zukommen zu lassen?",
  "sourceLang": "de",
  "emoji": "📧",
  "nativeMeaning": "Вежливая просьба прислать документы к определенному сроку в деловой переписке.",
  "nativeSynonyms": [],
  "translations": {
    "en": {
      "text": "Would you be so kind as to send me the documents by Friday?",
      "synonyms": [],
      "examples": [],
      "alternatives": null,
      "expressionType": null,
      "equivalentNote": null,
      "usageNote": null,
      "connotationWarning": null
    }
  }
}
```

#### Raw attempts

Attempt 1:

```json
{
  "emoji": "📧",
  "nativeMeaning": "Вежливая просьба прислать документы к определенному сроку в деловой переписке.",
  "translations": {
    "en": {
      "text": "Would you be so kind as to send me the documents by Friday?"
    }
  }
}
```

### informal-spanish-chat

- Category: informal-register
- Input: Hoy no me da la vida, ¿quedamos mañana?
- Source: es
- Targets: en
- Native language: cs
- Expected meaning: The speaker cannot attend today and suggests meeting tomorrow.
- Quality risks: literal quedar translation; wrong time reference; register too formal
- Status: completed
- Duration: 1780 ms

```json
{
  "original": "Hoy no me da la vida, ¿quedamos mañana?",
  "sourceLang": "es",
  "emoji": "🗓️",
  "nativeMeaning": "Vyjadření toho, že člověk má příliš mnoho povinností a nestíhá, proto navrhuje odložení schůzky na další den.",
  "nativeSynonyms": [],
  "translations": {
    "en": {
      "text": "I'm swamped today, can we meet tomorrow?",
      "synonyms": [],
      "examples": [],
      "alternatives": null,
      "expressionType": null,
      "equivalentNote": null,
      "usageNote": null,
      "connotationWarning": null
    }
  }
}
```

#### Raw attempts

Attempt 1:

```json
{
  "emoji": "🗓️",
  "nativeMeaning": "Vyjadření toho, že člověk má příliš mnoho povinností a nestíhá, proto navrhuje odložení schůzky na další den.",
  "translations": {
    "en": {
      "text": "I'm swamped today, can we meet tomorrow?"
    }
  }
}
```

### sarcasm-another-meeting

- Category: sarcasm
- Input: Great, another meeting. Exactly what I needed.
- Source: en
- Targets: ru
- Native language: cs
- Expected meaning: The speaker is annoyed about an additional meeting.
- Quality risks: interpreting praise literally; flattening the sarcastic tone; overexplaining inside the translation
- Status: completed
- Duration: 1054 ms

```json
{
  "original": "Great, another meeting. Exactly what I needed.",
  "sourceLang": "en",
  "emoji": "🙄",
  "nativeMeaning": "Ironické vyjádření frustrace z další zbytečné pracovní schůzky, které vyjadřuje přesný opak toho, co je řečeno.",
  "nativeSynonyms": [],
  "translations": {
    "ru": {
      "text": "Отлично, еще одно совещание. Как раз то, что мне было нужно.",
      "synonyms": [],
      "examples": [],
      "alternatives": null,
      "expressionType": null,
      "equivalentNote": null,
      "usageNote": null,
      "connotationWarning": null
    }
  }
}
```

#### Raw attempts

Attempt 1:

```json
{
  "emoji": "🙄",
  "nativeMeaning": "Ironické vyjádření frustrace z další zbytečné pracovní schůzky, které vyjadřuje přesný opak toho, co je řečeno.",
  "translations": {
    "ru": {
      "text": "Отлично, еще одно совещание. Как раз то, что мне было нужно."
    }
  }
}
```

### wordplay-fruit-flies

- Category: wordplay
- Input: Time flies like an arrow; fruit flies like a banana.
- Source: en
- Targets: ru
- Native language: cs
- Expected meaning: Preserve the contrast between flying time and fruit flies, or clearly prioritize meaning when the pun is impossible.
- Quality risks: nonsensical syntax; silent loss of wordplay; invented meaning
- Status: completed
- Duration: 1453 ms

```json
{
  "original": "Time flies like an arrow; fruit flies like a banana.",
  "sourceLang": "en",
  "emoji": "🍌",
  "nativeMeaning": "Humorná věta založená na vícesmyslnosti anglických slov, kde první část vyjadřuje rychlost času a druhá část vtipně popisuje ovocné mušky, které mají rády banány.",
  "nativeSynonyms": [],
  "translations": {
    "ru": {
      "text": "Время летит как стрела, а фруктовые мушки любят бананы.",
      "synonyms": [],
      "examples": [],
      "alternatives": null,
      "expressionType": null,
      "equivalentNote": null,
      "usageNote": null,
      "connotationWarning": null
    }
  }
}
```

#### Raw attempts

Attempt 1:

```json
{
  "emoji": "🍌",
  "nativeMeaning": "Humorná věta založená na vícesmyslnosti anglických slov, kde první část vyjadřuje rychlost času a druhá část vtipně popisuje ovocné mušky, které mají rády banány.",
  "translations": {
    "ru": {
      "text": "Время летит как стрела, а фруктовые мушки любят бананы."
    }
  }
}
```

### gender-marked-russian

- Category: grammatical-gender
- Input: Я была уверена, что он придёт.
- Source: ru
- Targets: en
- Native language: cs
- Expected meaning: A female speaker says she was certain he would come.
- Quality risks: losing the female-speaker signal in explanation; wrong pronoun; incorrect tense
- Status: completed
- Duration: 1042 ms

```json
{
  "original": "Я была уверена, что он придёт.",
  "sourceLang": "ru",
  "emoji": "⏳",
  "nativeMeaning": "Vyjadření přesvědčení mluvčí o budoucí události z pohledu minulosti.",
  "nativeSynonyms": [],
  "translations": {
    "en": {
      "text": "I was sure he would come.",
      "synonyms": [],
      "examples": [],
      "alternatives": null,
      "expressionType": null,
      "equivalentNote": null,
      "usageNote": null,
      "connotationWarning": null
    }
  }
}
```

#### Raw attempts

Attempt 1:

```json
{
  "emoji": "⏳",
  "nativeMeaning": "Vyjadření přesvědčení mluvčí o budoucí události z pohledu minulosti.",
  "translations": {
    "en": {
      "text": "I was sure he would come."
    }
  }
}
```

### ambiguous-duck

- Category: unresolved-ambiguity
- Input: I saw her duck.
- Source: en
- Targets: ru
- Native language: cs
- Expected meaning: Recognize that either her bird or her lowering movement may be meant.
- Quality risks: arbitrary sense selection; claiming certainty; grammatically invalid Russian
- Status: completed
- Duration: 3566 ms

```json
{
  "original": "I saw her duck.",
  "sourceLang": "en",
  "emoji": "🦆",
  "nativeMeaning": "Věta je syntakticky mnohoznačná: buď znamená, že jsem viděl, jak se ona (žena) přikrčila, nebo že jsem viděl její kachnu.",
  "sourceUsage": {
    "explanation": "Tato věta je klasickým příkladem syntaktické nejednoznačnosti v angličtině. Slovo 'duck' může být sloveso (přikrčit se) nebo podstatné jméno (kachna). V běžné konverzaci kontext obvykle určí význam, ale bez něj je věta nejasná.",
    "synonyms": [
      {
        "text": "I watched her crouch"
      },
      {
        "text": "I spotted her bird"
      }
    ],
    "examples": [
      {
        "context": "Viděl jsem, jak se rychle přikrčila, aby ji netrefil míč.",
        "target": "I saw her duck.",
        "native": "Viděl jsem, jak se přikrčila."
      },
      {
        "context": "Viděl jsem její domácí kachnu na zahradě.",
        "target": "I saw her pet bird.",
        "native": "Viděl jsem její kachnu."
      },
      {
        "context": "Sledoval jsem, jak se bleskově sklonila.",
        "target": "I observed her stoop.",
        "native": "Sledoval jsem, jak se sklonila."
      }
    ]
  },
  "nativeSynonyms": [
    {
      "text": "Viděl jsem, jak se přikrčila"
    },
    {
      "text": "Viděl jsem její kachnu"
    }
  ],
  "translations": {
    "ru": {
      "text": "Я видел, как она пригнулась.",
      "synonyms": [
        {
          "text": "Я видел, как она наклонилась"
        },
        {
          "text": "Я заметил, как она присела"
        }
      ],
      "examples": [
        {
          "context": "Ona se přikrčila před ranou.",
          "target": "Я видел, как она пригнулась.",
          "native": "Viděl jsem, jak se přikrčila."
        },
        {
          "context": "Viděl jsem její kachnu na rybníku.",
          "target": "Я видел её утку.",
          "native": "Viděl jsem její kachnu."
        },
        {
          "context": "Sledoval jsem, jak se rychle sklonila.",
          "target": "Я наблюдал, как она склонилась.",
          "native": "Sledoval jsem, jak se sklonila."
        }
      ],
      "expressionType": "literal",
      "equivalentNote": null,
      "usageNote": "V ruštině je nutné zvolit mezi slovesem (přikrčit se) a podstatným jménem (kachna), protože ruština nemá stejnou syntaktickou nejednoznačnost jako angličtina.",
      "alternatives": [
        {
          "text": "Я видел её утку.",
          "synonyms": [
            {
              "text": "Я заметил её утку"
            }
          ]
        },
        {
          "text": "Я наблюдал, как она склонилась.",
          "synonyms": [
            {
              "text": "Я смотрел, как она присела"
            }
          ]
        }
      ],
      "connotationWarning": null
    }
  }
}
```

#### Raw attempts

Attempt 1:

```json
{
  "emoji": "🦆",
  "nativeMeaning": "Věta je syntakticky mnohoznačná: buď znamená, že jsem viděl, jak se ona (žena) přikrčila, nebo že jsem viděl její kachnu.",
  "sourceUsage": {
    "explanation": "Tato věta je klasickým příkladem syntaktické nejednoznačnosti v angličtině. Slovo 'duck' může být sloveso (přikrčit se) nebo podstatné jméno (kachna). V běžné konverzaci kontext obvykle určí význam, ale bez něj je věta nejasná.",
    "synonyms": [
      {
        "text": "I watched her crouch"
      },
      {
        "text": "I spotted her bird"
      }
    ],
    "examples": [
      {
        "context": "Viděl jsem, jak se rychle přikrčila, aby ji netrefil míč.",
        "target": "I saw her duck.",
        "native": "Viděl jsem, jak se přikrčila."
      },
      {
        "context": "Viděl jsem její domácí kachnu na zahradě.",
        "target": "I saw her pet bird.",
        "native": "Viděl jsem její kachnu."
      },
      {
        "context": "Sledoval jsem, jak se bleskově sklonila.",
        "target": "I observed her stoop.",
        "native": "Sledoval jsem, jak se sklonila."
      }
    ]
  },
  "nativeSynonyms": [
    {
      "text": "Viděl jsem, jak se přikrčila"
    },
    {
      "text": "Viděl jsem její kachnu"
    }
  ],
  "translations": {
    "ru": {
      "text": "Я видел, как она пригнулась.",
      "synonyms": [
        {
          "text": "Я видел, как она наклонилась"
        },
        {
          "text": "Я заметил, как она присела"
        }
      ],
      "examples": [
        {
          "context": "Ona se přikrčila před ranou.",
          "target": "Я видел, как она пригнулась.",
          "native": "Viděl jsem, jak se přikrčila."
        },
        {
          "context": "Viděl jsem její kachnu na rybníku.",
          "target": "Я видел её утку.",
          "native": "Viděl jsem její kachnu."
        },
        {
          "context": "Sledoval jsem, jak se rychle sklonila.",
          "target": "Я наблюдал, как она склонилась.",
          "native": "Sledoval jsem, jak se sklonila."
        }
      ],
      "expressionType": "literal",
      "equivalentNote": null,
      "usageNote": "V ruštině je nutné zvolit mezi slovesem (přikrčit se) a podstatným jménem (kachna), protože ruština nemá stejnou syntaktickou nejednoznačnost jako angličtina.",
      "alternatives": [
        {
          "text": "Я видел её утку.",
          "synonyms": [
            {
              "text": "Я заметил её утку"
            }
          ]
        },
        {
          "text": "Я наблюдал, как она склонилась.",
          "synonyms": [
            {
              "text": "Я смотрел, как она присела"
            }
          ]
        }
      ],
      "connotationWarning": null
    }
  }
}
```

### homonym-crane-machine

- Category: homonym-with-context
- Input: The crane lifted the steel beam.
- Source: en
- Targets: cs
- Native language: ru
- Expected meaning: A construction crane lifted a steel beam.
- Quality risks: bird sense; wrong technical verb; unnatural Czech word order
- Status: completed
- Duration: 1180 ms

```json
{
  "original": "The crane lifted the steel beam.",
  "sourceLang": "en",
  "emoji": "🏗️",
  "nativeMeaning": "Подъемный кран поднял стальную балку на строительной площадке.",
  "nativeSynonyms": [],
  "translations": {
    "cs": {
      "text": "Jeřáb zvedl ocelový nosník.",
      "synonyms": [],
      "examples": [],
      "alternatives": null,
      "expressionType": null,
      "equivalentNote": null,
      "usageNote": null,
      "connotationWarning": null
    }
  }
}
```

#### Raw attempts

Attempt 1:

```json
{
  "emoji": "🏗️",
  "nativeMeaning": "Подъемный кран поднял стальную балку на строительной площадке.",
  "translations": {
    "cs": {
      "text": "Jeřáb zvedl ocelový nosník."
    }
  }
}
```

### code-switch-deploy

- Category: code-switching
- Input: Я уже сделал deploy, но prod всё ещё падает.
- Source: ru
- Targets: en
- Native language: ru
- Expected meaning: The deployment was already completed, but production is still failing.
- Quality risks: leaving avoidable mixed language; misreading deploy as a noun; loss of contrast
- Status: completed
- Duration: 1174 ms

```json
{
  "original": "Я уже сделал deploy, но prod всё ещё падает.",
  "sourceLang": "ru",
  "emoji": "🚀",
  "nativeMeaning": "Развертывание кода было выполнено, однако в производственной среде по-прежнему наблюдаются критические ошибки.",
  "nativeSynonyms": [],
  "translations": {
    "en": {
      "text": "I've already deployed, but prod is still crashing.",
      "synonyms": [],
      "examples": [],
      "alternatives": null,
      "expressionType": null,
      "equivalentNote": null,
      "usageNote": null,
      "connotationWarning": null
    }
  }
}
```

#### Raw attempts

Attempt 1:

```json
{
  "emoji": "🚀",
  "nativeMeaning": "Развертывание кода было выполнено, однако в производственной среде по-прежнему наблюдаются критические ошибки.",
  "translations": {
    "en": {
      "text": "I've already deployed, but prod is still crashing."
    }
  }
}
```

### noisy-chat-input

- Category: typos-and-abbreviations
- Input: idk tho u might be right lol
- Source: en
- Targets: cs
- Native language: ru
- Expected meaning: The speaker does not know but thinks the other person may be right.
- Quality risks: translating abbreviations literally; inventing certainty; over-formal Czech
- Status: completed
- Duration: 3396 ms

```json
{
  "original": "idk tho u might be right lol",
  "sourceLang": "en",
  "emoji": "🤔",
  "nativeMeaning": "Выражение неуверенности в своем мнении при одновременном допущении того, что собеседник может оказаться прав. Используется в неформальной переписке для смягчения спора.",
  "sourceUsage": {
    "explanation": "Эта фраза используется в неформальном общении, чтобы показать, что вы не до конца уверены в своей позиции, но признаете правоту собеседника. Она помогает избежать излишней категоричности и делает тон беседы более дружелюбным.",
    "synonyms": [
      {
        "text": "maybe you're right"
      },
      {
        "text": "i could be wrong"
      }
    ],
    "examples": [
      {
        "context": "Обсуждение фильма",
        "target": "idk tho u might be right lol",
        "native": "Не знаю, но, возможно, ты прав, ха-ха."
      },
      {
        "context": "Спор о планах на вечер",
        "target": "i'm not sure but you have a point",
        "native": "Не уверен, но в твоих словах есть смысл."
      },
      {
        "context": "Разговор о работе",
        "target": "actually you might be onto something",
        "native": "Слушай, а ведь ты, кажется, на верном пути."
      }
    ]
  },
  "nativeSynonyms": [
    {
      "text": "может, ты и прав"
    },
    {
      "text": "не уверен, но возможно"
    }
  ],
  "translations": {
    "cs": {
      "text": "nevím, ale možná máš pravdu",
      "synonyms": [
        {
          "text": "možná máš pravdu"
        },
        {
          "text": "třeba máš pravdu"
        }
      ],
      "examples": [
        {
          "context": "Diskuze o filmu",
          "target": "nevím, ale možná máš pravdu",
          "native": "Не знаю, но, возможно, ты прав."
        },
        {
          "context": "Plánování cesty",
          "target": "možná máš pravdu, kdo ví",
          "native": "Может, ты и прав, кто знает."
        },
        {
          "context": "Debata o sportu",
          "target": "třeba máš pravdu, je to možné",
          "native": "Может, ты и прав, это возможно."
        }
      ],
      "expressionType": "idiomatic_equivalent",
      "equivalentNote": "Чешский эквивалент передает ту же степень неуверенности и признания правоты собеседника в неформальном стиле.",
      "usageNote": "Используется в чатах для смягчения высказывания. Звучит естественно и не слишком официально.",
      "alternatives": [
        {
          "text": "možná máš pravdu, kdo ví",
          "synonyms": [
            {
              "text": "možná"
            }
          ]
        },
        {
          "text": "třeba máš pravdu, je to možné",
          "synonyms": [
            {
              "text": "třeba"
            }
          ]
        }
      ],
      "connotationWarning": "Фраза звучит очень по-дружески и неформально, не подходит для официальных писем."
    }
  }
}
```

#### Raw attempts

Attempt 1:

```json
{
  "emoji": "🤔",
  "nativeMeaning": "Выражение неуверенности в своем мнении при одновременном допущении того, что собеседник может оказаться прав. Используется в неформальной переписке для смягчения спора.",
  "sourceUsage": {
    "explanation": "Эта фраза используется в неформальном общении, чтобы показать, что вы не до конца уверены в своей позиции, но признаете правоту собеседника. Она помогает избежать излишней категоричности и делает тон беседы более дружелюбным.",
    "synonyms": [
      {
        "text": "maybe you're right"
      },
      {
        "text": "i could be wrong"
      }
    ],
    "examples": [
      {
        "context": "Обсуждение фильма",
        "target": "idk tho u might be right lol",
        "native": "Не знаю, но, возможно, ты прав, ха-ха."
      },
      {
        "context": "Спор о планах на вечер",
        "target": "i'm not sure but you have a point",
        "native": "Не уверен, но в твоих словах есть смысл."
      },
      {
        "context": "Разговор о работе",
        "target": "actually you might be onto something",
        "native": "Слушай, а ведь ты, кажется, на верном пути."
      }
    ]
  },
  "nativeSynonyms": [
    {
      "text": "может, ты и прав"
    },
    {
      "text": "не уверен, но возможно"
    }
  ],
  "translations": {
    "cs": {
      "text": "nevím, ale možná máš pravdu",
      "synonyms": [
        {
          "text": "možná máš pravdu"
        },
        {
          "text": "třeba máš pravdu"
        }
      ],
      "examples": [
        {
          "context": "Diskuze o filmu",
          "target": "nevím, ale možná máš pravdu",
          "native": "Не знаю, но, возможно, ты прав."
        },
        {
          "context": "Plánování cesty",
          "target": "možná máš pravdu, kdo ví",
          "native": "Может, ты и прав, кто знает."
        },
        {
          "context": "Debata o sportu",
          "target": "třeba máš pravdu, je to možné",
          "native": "Может, ты и прав, это возможно."
        }
      ],
      "expressionType": "idiomatic_equivalent",
      "equivalentNote": "Чешский эквивалент передает ту же степень неуверенности и признания правоты собеседника в неформальном стиле.",
      "usageNote": "Используется в чатах для смягчения высказывания. Звучит естественно и не слишком официально.",
      "alternatives": [
        {
          "text": "možná máš pravdu, kdo ví",
          "synonyms": [
            {
              "text": "možná"
            }
          ]
        },
        {
          "text": "třeba máš pravdu, je to možné",
          "synonyms": [
            {
              "text": "třeba"
            }
          ]
        }
      ],
      "connotationWarning": "Фраза звучит очень по-дружески и неформально, не подходит для официальных писем."
    }
  }
}
```

### japanese-politeness

- Category: cultural-politeness
- Input: お手すきの際にご確認いただけますでしょうか。
- Source: ja
- Targets: en
- Native language: ru
- Expected meaning: A polite request to review or confirm something when convenient.
- Quality risks: turning it into an order; losing indirectness; adding an unsupported object
- Status: completed
- Duration: 1256 ms

```json
{
  "original": "お手すきの際にご確認いただけますでしょうか。",
  "sourceLang": "ja",
  "emoji": "📧",
  "nativeMeaning": "Вежливая просьба проверить что-либо, когда у адресата будет свободное время.",
  "nativeSynonyms": [],
  "translations": {
    "en": {
      "text": "Could you please check this when you have a moment?",
      "synonyms": [],
      "examples": [],
      "alternatives": null,
      "expressionType": null,
      "equivalentNote": null,
      "usageNote": null,
      "connotationWarning": null
    }
  }
}
```

#### Raw attempts

Attempt 1:

```json
{
  "emoji": "📧",
  "nativeMeaning": "Вежливая просьба проверить что-либо, когда у адресата будет свободное время.",
  "translations": {
    "en": {
      "text": "Could you please check this when you have a moment?"
    }
  }
}
```

### negation-scope

- Category: negation-scope
- Input: I don't always agree with him.
- Source: en
- Targets: ru
- Native language: cs
- Expected meaning: The speaker sometimes agrees; it is not true that they never agree.
- Quality risks: moving negation to the wrong clause; changing frequency; unnatural Russian emphasis
- Status: completed
- Duration: 1344 ms

```json
{
  "original": "I don't always agree with him.",
  "sourceLang": "en",
  "emoji": "⚖️",
  "nativeMeaning": "Vyjádření skutečnosti, že s někým nemáte vždy stejný názor, což je běžná součást diskuse.",
  "nativeSynonyms": [],
  "translations": {
    "ru": {
      "text": "Я не всегда с ним согласен.",
      "synonyms": [],
      "examples": [],
      "alternatives": null,
      "expressionType": null,
      "equivalentNote": null,
      "usageNote": null,
      "connotationWarning": null
    }
  }
}
```

#### Raw attempts

Attempt 1:

```json
{
  "emoji": "⚖️",
  "nativeMeaning": "Vyjádření skutečnosti, že s někým nemáte vždy stejný názor, což je běžná součást diskuse.",
  "translations": {
    "ru": {
      "text": "Я не всегда с ним согласен."
    }
  }
}
```

### date-format-ambiguity

- Category: locale-sensitive-date
- Input: Let's meet on 06/07 at 5.
- Source: en
- Targets: de
- Native language: ru
- Expected meaning: Preserve the written date or make the ambiguity explicit; do not assume June 7 versus July 6.
- Quality risks: swapping month and day; inventing a locale; dropping the time
- Status: completed
- Duration: 927 ms

```json
{
  "original": "Let's meet on 06/07 at 5.",
  "sourceLang": "en",
  "emoji": "📅",
  "nativeMeaning": "Предложение встретиться в конкретную дату и время.",
  "nativeSynonyms": [],
  "translations": {
    "de": {
      "text": "Lass uns am 6. Juli um 17 Uhr treffen.",
      "synonyms": [],
      "examples": [],
      "alternatives": null,
      "expressionType": null,
      "equivalentNote": null,
      "usageNote": null,
      "connotationWarning": null
    }
  }
}
```

#### Raw attempts

Attempt 1:

```json
{
  "emoji": "📅",
  "nativeMeaning": "Предложение встретиться в конкретную дату и время.",
  "translations": {
    "de": {
      "text": "Lass uns am 6. Juli um 17 Uhr treffen."
    }
  }
}
```

### placeholder-preservation

- Category: technical-placeholders
- Input: Hello, {name}. You have {{count}} unread messages.
- Source: en
- Targets: cs
- Native language: ru
- Expected meaning: A user-facing notice that keeps {name} and {{count}} unchanged.
- Quality risks: translating placeholders; changing braces; incorrect plural meaning
- Status: completed
- Duration: 1011 ms

```json
{
  "original": "Hello, {name}. You have {{count}} unread messages.",
  "sourceLang": "en",
  "emoji": "✉️",
  "nativeMeaning": "Приветственное сообщение пользователю с указанием количества непрочитанных уведомлений в интерфейсе программы.",
  "nativeSynonyms": [],
  "translations": {
    "cs": {
      "text": "Ahoj, {name}. Máš {{count}} nepřečtených zpráv.",
      "synonyms": [],
      "examples": [],
      "alternatives": null,
      "expressionType": null,
      "equivalentNote": null,
      "usageNote": null,
      "connotationWarning": null
    }
  }
}
```

#### Raw attempts

Attempt 1:

```json
{
  "emoji": "✉️",
  "nativeMeaning": "Приветственное сообщение пользователю с указанием количества непрочитанных уведомлений в интерфейсе программы.",
  "translations": {
    "cs": {
      "text": "Ahoj, {name}. Máš {{count}} nepřečtených zpráv."
    }
  }
}
```

### markdown-preservation

- Category: format-preservation
- Input: Read the **important** [instructions](https://example.com/help) first.
- Source: en
- Targets: ru
- Native language: cs
- Expected meaning: Translate only visible prose while preserving emphasis and the exact link target.
- Quality risks: breaking Markdown; changing URL; dropping emphasis
- Status: completed
- Duration: 1001 ms

```json
{
  "original": "Read the **important** [instructions](https://example.com/help) first.",
  "sourceLang": "en",
  "emoji": "ℹ️",
  "nativeMeaning": "Pokyn k tomu, aby si uživatel nejprve přečetl klíčové informace v nápovědě.",
  "nativeSynonyms": [],
  "translations": {
    "ru": {
      "text": "Сначала прочитайте **важные** [инструкции](https://example.com/help).",
      "synonyms": [],
      "examples": [],
      "alternatives": null,
      "expressionType": null,
      "equivalentNote": null,
      "usageNote": null,
      "connotationWarning": null
    }
  }
}
```

#### Raw attempts

Attempt 1:

```json
{
  "emoji": "ℹ️",
  "nativeMeaning": "Pokyn k tomu, aby si uživatel nejprve přečetl klíčové informace v nápovědě.",
  "translations": {
    "ru": {
      "text": "Сначала прочитайте **важные** [инструкции](https://example.com/help)."
    }
  }
}
```

### proper-name-versus-common-noun

- Category: proper-name
- Input: Apple released an update for Safari.
- Source: en
- Targets: ru
- Native language: cs
- Expected meaning: Apple refers to the company and must remain a proper name.
- Quality risks: translating Apple as fruit; changing product name; incorrect capitalization
- Status: completed
- Duration: 895 ms

```json
{
  "original": "Apple released an update for Safari.",
  "sourceLang": "en",
  "emoji": "🍎",
  "nativeMeaning": "Společnost Apple vydala novou verzi svého webového prohlížeče Safari.",
  "nativeSynonyms": [],
  "translations": {
    "ru": {
      "text": "Apple выпустила обновление для Safari.",
      "synonyms": [],
      "examples": [],
      "alternatives": null,
      "expressionType": null,
      "equivalentNote": null,
      "usageNote": null,
      "connotationWarning": null
    }
  }
}
```

#### Raw attempts

Attempt 1:

```json
{
  "emoji": "🍎",
  "nativeMeaning": "Společnost Apple vydala novou verzi svého webového prohlížeče Safari.",
  "translations": {
    "ru": {
      "text": "Apple выпустила обновление для Safari."
    }
  }
}
```

### german-formality-du

- Category: pronoun-formality
- Input: Kannst du mir bitte das Foto schicken?
- Source: de
- Targets: ru
- Native language: cs
- Expected meaning: An informal request to a friend to send a photo.
- Quality risks: switching du to formal address; overly stiff Russian; wrong imperative tone
- Status: completed
- Duration: 978 ms

```json
{
  "original": "Kannst du mir bitte das Foto schicken?",
  "sourceLang": "de",
  "emoji": "📸",
  "nativeMeaning": "Zdvořilá žádost o zaslání fotografie mezi blízkými přáteli.",
  "nativeSynonyms": [],
  "translations": {
    "ru": {
      "text": "Можешь, пожалуйста, прислать мне фото?",
      "synonyms": [],
      "examples": [],
      "alternatives": null,
      "expressionType": null,
      "equivalentNote": null,
      "usageNote": null,
      "connotationWarning": null
    }
  }
}
```

#### Raw attempts

Attempt 1:

```json
{
  "emoji": "📸",
  "nativeMeaning": "Zdvořilá žádost o zaslání fotografie mezi blízkými přáteli.",
  "translations": {
    "ru": {
      "text": "Можешь, пожалуйста, прислать мне фото?"
    }
  }
}
```

### profanity-intensity

- Category: profanity-and-intensity
- Input: This thing is fucking broken.
- Source: en
- Targets: cs
- Native language: ru
- Expected meaning: The speaker strongly says the device is completely broken.
- Quality risks: sanitizing all emotion; escalating profanity; literal nonsense
- Status: completed
- Duration: 1197 ms

```json
{
  "original": "This thing is fucking broken.",
  "sourceLang": "en",
  "emoji": "🤬",
  "nativeMeaning": "Выражение сильного раздражения из-за неисправности устройства.",
  "nativeSynonyms": [],
  "translations": {
    "cs": {
      "text": "Tahle věc je v prdeli rozbitá.",
      "synonyms": [],
      "examples": [],
      "alternatives": null,
      "expressionType": null,
      "equivalentNote": null,
      "usageNote": null,
      "connotationWarning": null
    }
  }
}
```

#### Raw attempts

Attempt 1:

```json
{
  "emoji": "🤬",
  "nativeMeaning": "Выражение сильного раздражения из-за неисправности устройства.",
  "translations": {
    "cs": {
      "text": "Tahle věc je v prdeli rozbitá."
    }
  }
}
```

### euphemism-passed-away

- Category: euphemism
- Input: Her grandfather passed away last night.
- Source: en
- Targets: ru
- Native language: cs
- Expected meaning: Her grandfather died last night, expressed gently and respectfully.
- Quality risks: literal movement meaning; blunt register; wrong subject relation
- Status: completed
- Duration: 1177 ms

```json
{
  "original": "Her grandfather passed away last night.",
  "sourceLang": "en",
  "emoji": "🕊️",
  "nativeMeaning": "Eufemismus pro úmrtí blízké osoby, vyjadřující smutnou zprávu citlivým způsobem.",
  "nativeSynonyms": [],
  "translations": {
    "ru": {
      "text": "Её дедушка скончался прошлой ночью.",
      "synonyms": [],
      "examples": [],
      "alternatives": null,
      "expressionType": null,
      "equivalentNote": null,
      "usageNote": null,
      "connotationWarning": null
    }
  }
}
```

#### Raw attempts

Attempt 1:

```json
{
  "emoji": "🕊️",
  "nativeMeaning": "Eufemismus pro úmrtí blízké osoby, vyjadřující smutnou zprávu citlivým způsobem.",
  "translations": {
    "ru": {
      "text": "Её дедушка скончался прошлой ночью."
    }
  }
}
```

### ellipsis-shared-verb

- Category: ellipsis
- Input: John likes tea, and Mary coffee.
- Source: en
- Targets: cs
- Native language: ru
- Expected meaning: John likes tea, while Mary likes coffee.
- Quality risks: treating Mary as an object; dropping contrast; repeating the wrong verb
- Status: completed
- Duration: 1330 ms

```json
{
  "original": "John likes tea, and Mary coffee.",
  "sourceLang": "en",
  "emoji": "☕",
  "nativeMeaning": "Краткое сопоставление предпочтений двух людей.",
  "nativeSynonyms": [],
  "translations": {
    "cs": {
      "text": "John má rád čaj a Mary kávu.",
      "synonyms": [],
      "examples": [],
      "alternatives": null,
      "expressionType": null,
      "equivalentNote": null,
      "usageNote": null,
      "connotationWarning": null
    }
  }
}
```

#### Raw attempts

Attempt 1:

```json
{
  "emoji": "☕",
  "nativeMeaning": "Краткое сопоставление предпочтений двух людей.",
  "translations": {
    "cs": {
      "text": "John má rád čaj a Mary kávu."
    }
  }
}
```

### softened-imperative

- Category: pragmatic-softening
- Input: Could you close the window?
- Source: en
- Targets: es
- Native language: ru
- Expected meaning: A polite request to close the window.
- Quality risks: literal ability question; command too harsh; wrong politeness level
- Status: completed
- Duration: 1147 ms

```json
{
  "original": "Could you close the window?",
  "sourceLang": "en",
  "emoji": "🪟",
  "nativeMeaning": "Вежливая просьба закрыть окно.",
  "nativeSynonyms": [],
  "translations": {
    "es": {
      "text": "¿Podrías cerrar la ventana, por favor?",
      "synonyms": [],
      "examples": [],
      "alternatives": null,
      "expressionType": null,
      "equivalentNote": null,
      "usageNote": null,
      "connotationWarning": null
    }
  }
}
```

#### Raw attempts

Attempt 1:

```json
{
  "emoji": "🪟",
  "nativeMeaning": "Вежливая просьба закрыть окно.",
  "translations": {
    "es": {
      "text": "¿Podrías cerrar la ventana, por favor?"
    }
  }
}
```

## Quality analysis

### Executive summary

- All 30 translation requests produced structurally valid results.
- The primary translation was good or acceptable in most cases.
- One result, `polysemy-bank-river`, remained `needsReview` after all retries.
- Four cases required regeneration: `polysemy-bank-river`, `polysemy-pitch-business`, and `phrasal-verb-phase-out`; `polysemy-bank-river` used all three attempts.
- Source-language detection matched 62 of 72 expectations (86.1%).
- The strongest area was direct sentence translation with explicit context.
- The weakest areas were preservation of unresolved ambiguity, secondary learning metadata, locale-sensitive values, morphology around placeholders, and calibration of slang/profanity.

### Per-case assessment

| Case | Assessment | Main finding |
|---|---|---|
| `polysemy-bank-river` | Needs review | Primary `břeh` is correct, but `pobřeží` and especially `stráň` drift away from the requested river-bank sense. Three attempts did not remove the drift. |
| `polysemy-pitch-business` | Mostly correct | Meaning is understood, but final `Präsentation` is less precise than German `Pitch` in the supplied startup context. The first attempt had the stronger primary translation. |
| `idiom-break-a-leg` | Good | Correct Russian theatrical equivalent. Some alternatives and the warning overstate cultural rules. |
| `idiom-delo-v-shlyape` | Good | `It's in the bag` preserves meaning, confidence, and informality. |
| `idiom-maslo-na-hlave` | Needs review | `Skeleton in the closet` emphasizes a hidden shameful secret; the Czech idiom primarily means that the person is also guilty and should not criticize others. |
| `slang-lit-party` | Good | Natural Czech positive slang. Some alternatives are stronger than the source. |
| `slang-zaskamil` | Good | `He scammed me` is direct, natural, and register-appropriate. |
| `slang-to-je-husty` | Good | Positive polarity and youth slang were preserved with `That's sick!`. |
| `phrasal-verb-phase-out` | Good | Graduality was preserved in Czech and Russian. Retry was needed to complete the multi-language structure. |
| `false-friend-magazin` | Good | Correctly avoided English `magazine`; `grocery store` matches the supplied grocery context. |
| `formal-german-request` | Good | Politeness, deadline, and business register were preserved. |
| `informal-spanish-chat` | Good | `I'm swamped today` naturally captures `no me da la vida`. |
| `sarcasm-another-meeting` | Good | Literal wording remains usable as sarcasm in Russian, supported by context and punctuation. |
| `wordplay-fruit-flies` | Acceptable with loss | Propositional meaning is clear, but the syntactic pun is lost in Russian. The explanation recognizes the wordplay; the translation itself does not signal the loss. |
| `gender-marked-russian` | Information loss | English cannot encode the female speaker in the same verb form, but the native explanation also omitted that the speaker is female. |
| `ambiguous-duck` | Mostly good | Both parses are recognized and represented, but one is still selected as the primary translation despite the absence of context. |
| `homonym-crane-machine` | Good | Correct construction-machine sense and natural Czech wording. |
| `code-switch-deploy` | Mostly correct | Meaning and contrast are preserved. `prod` remains jargon, and `crashing` is stronger than generic `failing`. |
| `noisy-chat-input` | Mostly correct | Core meaning is preserved, but `lol`, playful tone, and some chat-like informality disappear. |
| `japanese-politeness` | Mostly correct | Indirect politeness is preserved, but `this` introduces an object not present in the supplied sentence. |
| `negation-scope` | Good | Correctly preserves “not always,” rather than changing it to “never.” |
| `date-format-ambiguity` | Incorrect | The model silently resolves `06/07` as 6 July and `at 5` as 17:00 despite the explicit lack of locale and time context. |
| `placeholder-preservation` | Needs review | Both placeholders are preserved exactly, but fixed Czech morphology fails for values such as 1 or 2–4. |
| `markdown-preservation` | Good | Markdown emphasis and URL are preserved correctly. |
| `proper-name-versus-common-noun` | Good | Apple and Safari remain proper product/company names. |
| `german-formality-du` | Good | Informal second-person address is preserved naturally in Russian. |
| `profanity-intensity` | Incorrect/unnatural | `Tahle věc je v prdeli rozbitá` is awkward and semantically redundant Czech; intensity was preserved, but not natural expression. |
| `euphemism-passed-away` | Good | Russian `скончался` preserves respectful euphemistic register. |
| `ellipsis-shared-verb` | Good | Czech naturally reconstructs the omitted verb without changing argument roles. |
| `softened-imperative` | Good | Spanish preserves the polite request rather than treating it as a literal ability question. |

### Repeating translation patterns

#### 1. Primary translations are stronger than auxiliary fields

The main `text` field is usually accurate and natural. Quality degrades in:

- synonyms that are only loosely related;
- alternatives that shift meaning or intensity;
- examples that demonstrate an alternative instead of the primary translation;
- connotation warnings that exaggerate usage restrictions;
- explanatory notes that present conventions as mandatory rules.

Examples:

- Correct Czech `břeh` is accompanied by `stráň`, which means a slope rather than a normal river bank.
- Correct `Ни пуха, ни пера!` is accompanied by `В добрый путь`, which does not fit the theatrical situation.
- Correct Czech slang `totální pecka` is followed by stronger options such as `masakr`.

#### 2. More generated variants increase semantic drift

When the model must provide a primary translation, synonyms, two alternatives, and several examples, later fields often stop being interchangeable variants of the same meaning. They become adjacent concepts.

This is most visible in `bank`, `pitch`, `mít máslo na hlavě`, slang cases, and `phase out`.

#### 3. The model understands ambiguity semantically but still resolves it operationally

The model can explain ambiguity correctly:

- `I saw her duck` is described with both valid parses.
- `Time flies ... fruit flies ...` is recognized as wordplay.

However, it still emits one definitive primary translation even when the source intentionally lacks enough context. The same tendency appears more strongly in source-language detection.

#### 4. The model normalizes underspecified locale data instead of preserving uncertainty

`06/07 at 5` was converted to `6. Juli um 17 Uhr`. Both the date interpretation and 24-hour time were inferred without evidence.

This is a high-severity pattern because the resulting sentence is fluent and looks trustworthy while changing factual information.

#### 5. Exact token preservation does not imply grammatical correctness

The placeholders `{name}` and `{{count}}` were preserved byte-for-byte. The surrounding Czech sentence is still unsafe because plural morphology depends on the runtime count.

The model treats immutable placeholders as ordinary nouns with a single assumed grammatical environment.

#### 6. Register handling is generally strong, but extremes are poorly calibrated

The model performs well on:

- formal German business language;
- Spanish informal scheduling;
- Japanese indirect politeness;
- Czech and English youth slang;
- respectful death euphemism.

At stronger profanity levels it preserves emotional force but produces unnatural Czech syntax. Some slang alternatives also escalate intensity beyond the source.

#### 7. Subtle source information is omitted when the target language does not encode it directly

The Russian sentence marks the speaker as female through `была уверена`. English naturally loses that morphology, but the native explanation also omits it. Similarly, `lol` disappears from the noisy chat translation.

The model preserves proposition-level meaning more reliably than speaker identity, stance markers, and discourse particles.

#### 8. Retry does not guarantee semantic improvement

- `bank` remained problematic after three attempts.
- For `pitch`, the first attempt's German `Pitch` was more contextually precise than the final `Präsentation`.
- Retries appear effective for schema completion, as in `phase out`, but may replace a strong semantic choice with a safer generic one.

### Source-language detection patterns

The detector matched 62/72 cases. It handled:

- most English/German, English/French, and English/Spanish homographs;
- clear multi-word context;
- Russian/Ukrainian and Czech/Slovak full sentences in most cases;
- code-switching where one language supplies the grammar;
- names, brands, acronyms, typos, and unaccented text.

The ten failures form four groups:

1. **Incomplete lexical ambiguity coverage**
   - `fast` was classified as English in all three ambiguous configurations.
   - Other English/German homographs correctly triggered clarification.

2. **Closely related languages**
   - `привет` was forced to Russian rather than left unresolved between Russian and Ukrainian.
   - Slovak `Dnes je krásne počasie a pôjdeme von` was classified as Czech.
   - Shared Croatian/Serbian `dobar` was forced to Croatian.

3. **Transliteration and keyboard-layout errors**
   - `privet kak dela`, `pryvit yak spravy`, and `ghbdtn` were all classified as English because their visible script is Latin.

4. **Statistical misclassification of a valid contextual sentence**
   - French `Je voudrais acheter du pain frais` was classified as English.

### What the model consistently understands

- Ordinary lexical disambiguation when explicit context is supplied.
- Idiomatic equivalence for common, well-represented expressions.
- Formality and politeness in mainstream language pairs.
- Negation scope, ellipsis, proper names, Markdown structure, and code-switching.
- Structured output requirements and required language blocks.

### What the model does not consistently understand

- That uncertainty itself can be the correct output.
- That alternatives must preserve the same sense and comparable intensity.
- That examples should remain anchored to the assigned primary translation.
- That locale-sensitive dates and times must not be normalized without evidence.
- That placeholders can control target-language morphology.
- That grammatical gender and discourse markers remain meaningful even when the target sentence cannot encode them directly.
- That preserving profanity intensity is different from producing a literal or syntactically awkward vulgar phrase.
- That retries should correct the cited semantic defect rather than merely produce another valid-looking variant.

### Final quality judgment

Gemini 3.1 Flash Lite is reliable for straightforward sentence translation and common idioms in this dataset. It is less reliable as a generator of rich pedagogical metadata and as a decision-maker for ambiguous input. The fluent surface form can hide factual assumptions (`06/07`), semantic broadening (`stráň`, `skeleton in the closet`), or grammatical limitations around runtime placeholders.

This report intentionally stops at observed behavior and recurring failure patterns. It does not propose prompt or architecture changes.
