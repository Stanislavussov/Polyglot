# План повышения качества перевода Polyglot

## Статус реализации

- [x] Шаг 1: benchmark cases версионированы и получили исполняемые quality assertions. Отчёт содержит prompt/schema versions, model settings, raw attempts и точные причины quality failures; CLI возвращает ненулевой код при regression.
- [x] Шаг 2: введён `TranslationDecision` контракт с тремя статусами (`accepted`, `needs_clarification`, `needs_review`), типизированные причины уточнения (`TranslationAmbiguity`), quality metadata (`QualityMetadata`, `QualityIssue`, `RiskLevel`). Функции `translate()`, `translateOne()`, `translateBatch()` и context-enrichment обёртки возвращают `TranslationDecision`. Рендерер принимает `needsReview` параметр. `needs_clarification` статус определён, но ещё не производится (логика обнаружения неоднозначности — Шаг 4).
- [x] Шаг 3: перенесён input analysis в core (`packages/core/src/modules/input-analysis/`), обогащён детекцией placeholders, URL, Markdown, дат и code-switching. Добавлена confidence-aware language detection (`detectLanguageWithConfidence` / `detectLanguageWithConfidenceAsync`) с candidate-aware scoring для близких языков (cs/sk, hr/sr) и confidence threshold. При ambiguous detection бот показывает inline keyboard с вариантами языков вместо generic mistype warning. Добавлены `DetectionResult`, `DetectionEvidence` типы и `detectionConfidence` поле в `QualityMetadata`.
- [x] Шаг 4: добавлен risk-based quality pipeline. Для всех input types выполняются deterministic semantic и immutable-token проверки; high-risk результаты проверяются моделью другого семейства; blocking issues исправляются targeted repair только затронутого language block. Full retry оставлен только для generation/schema failures. До generation возвращается clarification для неоднозначных numeric dates и mixed-script/transliterated input.
- [x] Шаг 5: benchmark запускает stochastic translation/detection cases многократно, считает отдельные quality dimensions, latency/cost и repair success, сравнивает минимум три класса моделей, сохраняет JSON baseline и блокирует статистически значимые regression по language pair. Release gates защищают immutable spans, ambiguity handling, primary/metadata accuracy и single-call low-risk path.
- [x] Шаг 6: invariant validators для предложений и technical text теперь симметрично проверяют immutable spans: output не может удалить, изменить count или добавить placeholders, URL, Markdown link targets, dates и numbers, отсутствующие в source.
- [x] Шаг 7: введён points-based risk score (`low`/`medium`/`high`) и cross-model semantic judge для high-risk результатов. Phrase/sentence input, risky register/topic hints, low detection confidence, uncommon language pairs, structural immutable features, multi-sense/idiom dictionary context и deterministic failures переводят запрос в high risk; ordinary unbacked words остаются single-call medium risk, а confident dictionary-backed minimal words — low risk.
- [ ] Шаги 8–10: остаются в порядке, описанном ниже. Dataset содержит 31 translation и 72 detection reviewed fixtures; расширение до 200–500 уникальных reviewed cases остаётся отдельной последовательной работой, а не синтетическим дублированием. Generic word-sense clarification ещё не реализован: без ranked sense IDs и confidence margin pipeline не имитирует его hardcoded-фразами.

Изменённые файлы:

- `apps/translation-benchmark/src/benchmark-cases.ts`
- `apps/translation-benchmark/src/benchmark-runner.ts`
- `apps/translation-benchmark/src/benchmark-runner.test.ts`
- `apps/translation-benchmark/src/cli.ts`
- `apps/translation-benchmark/src/cli.test.ts`
- `apps/translation-benchmark/README.md`
- `apps/translation-benchmark/README.md`
- `apps/bot/src/renderers/translation.renderer.ts`
- `apps/bot/src/scenes/helpers/translate-mode.helper.ts`
- `apps/bot/src/scenes/helpers/regen.helper.ts`
- `apps/bot/src/scenes/helpers/__tests__/translate-mode-detection.test.ts`
- `apps/bot/src/utils/vocabulary-mapper.test.ts`
- `packages/core/src/modules/translation/types.ts`
- `packages/core/src/modules/translation/translation.service.ts`
- `packages/core/src/modules/translation/quality.schema.ts`
- `packages/core/src/modules/translation/index.ts`
- `packages/core/src/modules/translation/__tests__/translation.service.test.ts`
- `packages/core/src/modules/translation/__tests__/dictionary-context.test.ts`
- `packages/core/src/modules/translation/__tests__/output-config.test.ts`
- `packages/core/src/modules/context-enrichment/context-enrichment.service.ts`
- `packages/core/src/modules/context-enrichment/__tests__/context-enrichment.service.test.ts`
- `packages/core/src/modules/validation/index.ts`
- `packages/core/src/modules/validation/validation.service.ts`
- `packages/core/src/modules/validation/validators/immutable.validator.ts`
- `packages/core/src/modules/validation/validators/semantic.validator.ts`
- `packages/core/src/modules/validation/__tests__/validate.test.ts`
- `packages/core/src/modules/validation/__tests__/semantic.validator.test.ts`
- `.pi/skills/validation/SKILL.md`
- `.pi/skills/translation/SKILL.md`
- `CHANGELOG.md`

  ## Результаты анализа

  Текущий pipeline хорошо переводит обычные предложения, но принимает структурно корректные ответы за
  качественные. Основные причины:

  - Перегруженный промпт одновременно требует основной перевод, синонимы, альтернативы, примеры и пояснения.
    Чем дальше поле от text, тем сильнее semantic drift.

  - Валидатор проверяет преимущественно JSON, пустые значения и повторы исходного текста. Фактическая
    эквивалентность, естественность, регистр и сохранение фактов почти не проверяются.

  - Для предложений semantic validation полностью отключена. Поэтому неверная дата, неестественная
    ненормативная лексика и проблемы с placeholders проходят без замечаний.

  - Полный retry заменяет весь ответ и может ухудшить уже правильные поля.
  - Классификация word/phrase/sentence основана только на количестве слов. Короткие предложения могут попасть
    в тяжёлый word/phrase-промпт.

  - Dictionary enrichment используется только при единственном найденном результате. Ranking контекстных
    значений отсутствует.

  - Language detector возвращает язык без confidence/evidence. Порядок пересекающихся диакритических правил
    создаёт систематические ошибки для близких языков.

  - Транслитерация и неправильная раскладка ошибочно считаются английским из-за Latin script.
  - Benchmark сохраняет raw output, но не содержит исполняемых критериев качества, prompt/schema versions и
    автоматического сравнения моделей.

  Целевая стратегия: быстрый single-call для безопасных случаев, risk-based judge и targeted repair для
  сложных.

  ## 1. Контракт и обработка неопределённости

  - Заменить неявное TranslationResult на результат orchestration:

    type TranslationDecision =
      | { status: "accepted"; output: TranslateOutput; quality: QualityMetadata }
      | { status: "needs_clarification"; ambiguity: TranslationAmbiguity }
      | { status: "needs_review"; output: TranslateOutput; issues: QualityIssue[] };

  - Добавить типизированные причины уточнения:
      - source_language;
      - word_sense;
      - date_or_time;
      - placeholder_grammar;
      - mixed_or_transliterated_input.

  - При недостаточных данных не выбирать вариант молча. Бот должен показать конкретные варианты языка, смысла
    или даты до запуска перевода.

  - Сохранять исходные неизменяемые элементы: placeholders, URL, Markdown-разметку, числа, даты, имена и
    технические идентификаторы.

  - Для placeholders проверять не только сохранность токена, но и зависимость грамматики от runtime-значения.
    Если безопасная формулировка невозможна, возвращать clarification/review вместо одного потенциально
    неверного множественного числа.

  - Добавить promptVersion, schemaVersion, riskLevel, modelId, attemptCount, judgeResult и список quality
    issues в metadata.

  ## 2. Подготовка входа, язык и значение

  ### Input analysis

  - Вынести анализ входа из Telegram helper в core-сервис.
  - Определять тип по совокупности признаков: токены, пунктуация, синтаксический вид, placeholders, Markdown,
    URL, даты, code switching.

  - Выделять immutable spans до передачи модели и восстанавливать их после generation.
  - Не называть недетектированный язык «опечаткой»: это может быть омограф, имя, транслитерация или смешанный
    текст.

  ### Language detection

  - Возвращать { language, confidence, evidence }, а не только код языка.
  - Перестроить стратегии в conservative ensemble:
      1. immutable/name/acronym/noise detection;
      2. keyboard-layout и transliteration detection;
      3. script evidence;
      4. действительно уникальные диакритические признаки;
      5. dictionary matches;
      6. статистическая модель с confidence margin;
      7. AI fallback с обязательной возможностью ambiguous.

  - Не считать Latin script достаточным доказательством английского при кандидатах en + Cyrillic language.
  - Заменить ordered regex для cs/sk, hr/sr и других близких языков на candidate-aware scoring; общие символы
    не должны давать победу первому языку.

  - Если два dictionary-кандидата или confidence ниже порога, возвращать clarification.
  - Целевые метрики: не менее 95% общего detection accuracy и 100% отказов от принудительного выбора на
    benchmark-кейсах с ожидаемым ask_source_language.

  ### Sense selection

  - Ранжировать dictionary senses отдельно от generation по exact form, lemma, POS, context hint и input type.
  - Передавать в промпт максимум два значения с идентификатором и confidence.
  - При близких confidence запрашивать смысл у пользователя.
  - Включать выбранный senseId в evaluation, telemetry и будущий cache key.

  ## 3. Переработка generation-промптов

  - Разделить один большой builder на специализированные режимы:
      - sentence translation;
      - lexical translation;
      - idiom/slang;
      - technical/localization text;
      - targeted field repair.

  - В начале каждого промпта фиксировать инварианты: meaning, negation, dates, numbers, register, speaker
    traits, formatting и immutable spans.

  - Явно требовать сохранения неопределённости: запрещать нормализовывать дату, время, пол, смысл или locale
    без данных.

  - Для word/phrase сначала выбрать основной перевод, затем генерировать metadata, жёстко привязанную к
    выбранному sense и основной формулировке.

  - Отказаться от безусловных «ровно 2 альтернативы» и «3 разных выражения». Разрешать пустой или сокращённый
    список, если эквивалентных вариантов нет.

  - Альтернативы должны сохранять:
      - тот же sense;
      - сопоставимый регистр и интенсивность;
      - тот же контекст;
      - отсутствие более широкого или соседнего значения.

  - Example 1 должен демонстрировать main translation. Остальные примеры создаются только для явно назначенной
    альтернативы или синонима.

  - Для idiom/wordplay разрешить отдельное описание потери формы и запретить выдавать приблизительный
    эквивалент как точный.

  - Для sentence output добавить компактные поля preservedFacts/uncertainties только для внутренней проверки;
    пользователю показывать обычный перевод.

  - Снизить temperature для переводов до детерминированного model-appropriate значения, ориентировочно 0–0.1.
    Настройки generation передавать через request policy, а не держать константами адаптера.

  ## 4. Quality pipeline и retries

  ### Детерминированная проверка

  Проверять для всех input types, включая предложения:

  - schema и требуемые языки;
  - точное сохранение placeholders, URL, Markdown targets, чисел и неоднозначных дат;
  - отсутствие добавленных объектов, дат, времени и имён;
  - writing system и запрещённую транслитерацию;
  - соответствие examples назначенным вариантам;
  - отсутствие дубликатов и исходного context hint;
  - число, отрицание и основные structural facts.

  Не отключать semantic validation целиком для предложений; отключать только нерелевантную проверку
  translation !== original.

  ### Risk score

  Считать запрос high-risk при любом из условий:

  - неоднозначный язык или sense;
  - phrase, idiom, slang, sarcasm, profanity или wordplay;
  - dictionary miss или несколько senses;
  - дата, число, placeholder, Markdown либо code switching;
  - uncommon language pair;
  - rich metadata;
  - ошибка детерминированной проверки.

  Простой dictionary-backed word с confidence ≥ 0.85 остаётся на single-call пути.

  ### Semantic judge

  - Запускать только для high-risk результатов.
  - Использовать модель другого семейства относительно generator.
  - Проверять отдельно main translation и auxiliary fields по четырём критериям: meaning, naturalness,
    register/intensity, unsupported assumptions.

  - Возвращать QualityIssue[] с точным field path, severity и repair instruction.
  - Любая silent factual assumption, поломка immutable token или неверный основной смысл является blocking
    issue.

  ### Targeted repair

  - Регенерировать только проблемное поле или language block.
  - Передавать accepted main translation, sense, context и соседние принятые поля как immutable anchors.
  - После repair повторять только относящиеся к полю проверки.
  - Полный retry использовать лишь для generation/schema failure.
  - Объединить retry budgets AI SDK и translation service, чтобы исключить каскад до нескольких скрытых
    provider attempts.

  - Не заменять уже принятый text из-за ошибки примера или отсутствующего metadata.

  ## 5. Benchmark, модели и контроль регрессий

  - Превратить benchmark cases в versioned fixtures с:
      - допустимыми переводами или semantic rubric;
      - запрещёнными смыслами и предположениями;
      - ожидаемым ambiguity action;
      - immutable tokens;
      - требованиями к регистру и metadata.

  - Раздельно считать:
      - main translation accuracy;
      - auxiliary-field accuracy;
      - factual preservation;
      - naturalness/register;
      - ambiguity handling;
      - detection accuracy;
      - repair success;
      - latency и стоимость.

  - Добавить в отчёт фактический prompt, prompt/schema version, model settings, validation issues и причины
    retries.

  - Запускать каждый stochastic case несколько раз и показывать pass rate, а не один удачный ответ.
  - Расширить dataset до 200–500 reviewed cases, начиная со всех ошибок текущего отчёта.
  - Сравнить минимум три класса моделей: экономичная, mid-tier и сильная модель другого провайдера.
  - Критерии выпуска:
      - 0 silent changes placeholders, URL, чисел и дат;
      - 0 принудительных решений для ожидаемой неопределённости;
      - ≥95% корректных primary translations;
      - ≥90% корректных generated metadata;
      - отсутствие статистически значимой регрессии по каждой language pair;
      - простой путь не получает judge и сохраняет текущий порядок latency/cost.

  ## 6. Порядок реализации

  1. Версионировать benchmark и добавить исполняемые quality assertions.
  2. Ввести TranslationDecision, ambiguity и quality metadata.
  3. Перенести input analysis в core и исправить language detection.
  4. Реализовать sense ranking и clarification flow.
  5. Разделить prompts и ослабить принудительную генерацию вариантов.
  6. Добавить invariant validators для предложений и technical text.
  7. Ввести risk score и cross-model semantic judge.
  8. Заменить full retry на targeted repair.
  9. Провести model benchmark и настроить routing по risk level.
  10. Добавить telemetry, staged rollout и user-feedback loop.

  Каждый slice обновляет CHANGELOG.md, соответствующую .pi/skills документацию и проходит полный project
  quality gate из AGENTS.md.

  ## Ключевые тесты

  - Все 30 translation cases и 72 detection cases из отчёта становятся regression fixtures; дополнительно
    low-risk single-call path защищён отдельным 31-м translation fixture.
  - bank не допускает stráň; mít máslo na hlavě не принимается как skeleton in the closet.
  - 06/07 at 5 вызывает clarification и не превращается в конкретную дату/17:00.
  - {name} и {{count}} сохраняются byte-for-byte; небезопасная plural morphology блокируется.
  - I saw her duck не получает единственный уверенный смысл.
  - Женский пол говорящей сохраняется в metadata для русского исходника.
  - Profanity сохраняет интенсивность без неестественной конструкции.
  - Ошибка третьего примера не изменяет правильный основной перевод.
  - fast, привет, dobar, transliteration и keyboard-layout cases не получают необоснованный язык.
  - Slovak context не проигрывает Czech из-за порядка regex.
  - Простое однозначное слово выполняется одним generation request без judge.
  - High-risk запрос проходит generate → validate → judge → targeted repair с ограниченным общим retry budget.

  ## Принятые допущения

  - Выбран risk-based hybrid: максимальные проверки применяются только к рискованным запросам.
  - При значимой неопределённости продукт спрашивает пользователя до перевода.
  - Single-request generation остаётся основным путём; multi-call применяется для judge и точечного repair.
  - Fine-tuning и verified cache откладываются до появления стабильного контракта и reviewed evaluation
    dataset.
