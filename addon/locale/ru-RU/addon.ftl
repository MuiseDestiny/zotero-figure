menu-analyze = Анализировать рисунки, таблицы и формулы PDF
menu-cancel-analysis = Отменить анализ макета
menu-view-figures = Показывать только созданные рисунки
menu-view-annotations = Показывать только обычные аннотации
menu-add-note = Добавить рисунки в заметку
menu-remove-generated = Удалить созданные аннотации рисунков
menu-remove-all = Удалить все аннотации
reader-menu-add-to-figure = Добавить в Figure
progress-add-to-results = Добавление аннотаций изображений в результаты анализа…
progress-add-to-results-done = Добавлено аннотаций изображений: { $created } (уже были: { $skipped })

batch-menu-analyze = Анализировать рисунки, таблицы и формулы
batch-menu-analyze-note = Анализировать рисунки, таблицы и формулы и добавить в заметку
batch-menu-analyze-annotations = Анализировать рисунки, таблицы и формулы и создать аннотации
batch-progress-no-annotations = Изображения с аннотациями не выбраны
batch-progress-import-done = Импортировано аннотаций изображений: { $created } ({ $skipped } уже были), ошибок { $failed }
batch-progress-no-pdf = Ни у одного выбранного элемента нет доступного PDF-вложения
batch-progress-already-running = Пакетная обработка PDF Figure уже выполняется
batch-progress-current = [{ $current }/{ $total }] { $title }: { $detail }
batch-progress-finished-item = Завершен PDF { $current } из { $total }
batch-progress-done = Завершено PDF: { $succeeded }, с ошибкой: { $failed }, найдено результатов: { $results }, создано заметок: { $notes }, аннотаций: { $annotations }

gallery-title = Библиотека иллюстраций PDF
gallery-menu-open = Библиотека иллюстраций PDF
gallery-refresh =
    .title = Обновить индекс библиотеки
    .aria-label = Обновить индекс библиотеки
gallery-reset-filters =
    .title = Сбросить фильтры и поиск
    .aria-label = Сбросить фильтры и поиск
gallery-toolbar-collapse =
    .title = Свернуть фильтры
    .aria-label = Свернуть фильтры
gallery-toolbar-expand =
    .title = Показать все фильтры
    .aria-label = Показать все фильтры
gallery-view-switch-to-documents =
    .title = Переключиться на колонки документов
    .aria-label = Переключиться на колонки документов
gallery-view-switch-to-waterfall =
    .title = Переключиться на каскадный вид
    .aria-label = Переключиться на каскадный вид
gallery-scale-toggle =
    .title = Изменить размер изображений
    .aria-label = Изменить размер изображений
gallery-scale-label = Размер изображений
gallery-scale-range =
    .aria-label = Размер изображений
gallery-comparison-rows = Параметры сравнения
gallery-comparison-result-count = Результатов: { $count }
gallery-comparison-name-row =
    .title = Назвать строку сравнения
    .aria-label = Назвать строку сравнения
gallery-comparison-row-label =
    .placeholder = Название строки
    .aria-label = Название строки сравнения
gallery-comparison-add-row =
    .title = Добавить строку сравнения
    .aria-label = Добавить строку сравнения
gallery-comparison-add-to-group = Добавить в группу
gallery-comparison-group-default = Группа { $index }
gallery-comparison-no-other-groups = Нет других групп
gallery-comparison-dissolve-group = Расформировать группу
gallery-comparison-make-primary = Сделать { $tag } главным изображением
gallery-comparison-previous =
    .title = Предыдущее изображение сравнения
    .aria-label = Предыдущее изображение сравнения
gallery-comparison-next =
    .title = Следующее изображение сравнения
    .aria-label = Следующее изображение сравнения
gallery-filter-document = Документ
gallery-filter-year = Год
gallery-filter-collection = Категория
gallery-filter-type = Тип
gallery-filter-keyword = Ключевое слово подписи
gallery-filter-keyword-placeholder =
    .placeholder = Поиск по подписям
gallery-filter-all-documents = Все документы
gallery-filter-all-years = Все годы
gallery-filter-all-collections = Все категории
gallery-filter-all-types = Все типы
gallery-kind-figure = Рисунок
gallery-kind-table = Таблица
gallery-kind-formula = Формула
gallery-result-count = { $filtered }/{ $total }
gallery-page = Страница { $page }
gallery-loading = Загрузка индекса иллюстраций...
gallery-load-error = Не удалось загрузить индекс иллюстраций
gallery-api-unavailable = API браузера PDF Figure недоступен
gallery-no-libraries = Нет доступных библиотек Zotero
gallery-empty-library = В этой библиотеке нет локальных рисунков, таблиц или формул
gallery-empty-filtered = Нет результатов, соответствующих текущим фильтрам
gallery-image-loading = Загрузка предпросмотра...
gallery-image-error = Предпросмотр недоступен

sidebar-title = Zotero Figure
sidebar-analyze = Анализировать рисунки, таблицы и формулы
sidebar-cancel = Отменить анализ
sidebar-translate = Перевести подписи
sidebar-show-original = Показать оригинал
sidebar-expand-caption = Развернуть подпись
sidebar-collapse-caption = Свернуть подпись
sidebar-translation-error = Не удалось перевести некоторые подписи; показан исходный текст
sidebar-sync-annotations = Преобразовать локальные результаты в аннотации Zotero
sidebar-add-all-to-note = Добавить все результаты в заметку
sidebar-clear = Очистить локальные результаты
sidebar-loading = Загрузка локальных результатов...
sidebar-load-error = Не удалось загрузить локальные результаты
sidebar-analysis-progress-title = Анализ документа
sidebar-filter-figure =
    { $count ->
        [one] Рисунок
        [few] Рисунка
        [many] Рисунков
       *[other] Рисунка
    }
sidebar-filter-table =
    { $count ->
        [one] Таблица
        [few] Таблицы
        [many] Таблиц
       *[other] Таблицы
    }
sidebar-filter-formula =
    { $count ->
        [one] Формула
        [few] Формулы
        [many] Формул
       *[other] Формулы
    }
sidebar-refresh = Обновить рисунки, таблицы и формулы
sidebar-empty = Нет созданных рисунков, таблиц или формул
sidebar-start-analysis = Начать анализ
sidebar-page = Страница { $page }
sidebar-image-preparing = Подготовка изображения...
sidebar-image-unavailable = Изображение недоступно
sidebar-no-caption = Без подписи
sidebar-untitled = Рисунок, таблица или формула без названия
sidebar-menu = Действия с рисунком, таблицей или формулой
sidebar-copy-image = Копировать изображение
sidebar-copy-latex = Копировать LaTeX
sidebar-copy-latex-loading = Преобразование формулы в LaTeX
sidebar-copy-latex-success = LaTeX скопирован
sidebar-copy-latex-failed = Ошибка преобразования в LaTeX: { $message }
sidebar-rerecognize-latex = Распознать формулу заново
sidebar-rerecognize-latex-loading = Повторное распознавание формулы
sidebar-rerecognize-latex-success = Формула распознана заново
sidebar-formula-latex = LaTeX формулы
sidebar-save-image = Сохранить изображение как...
sidebar-pin-image = Закрепить изображение
sidebar-go-to-page = Перейти к странице
sidebar-edit-comment = Изменить подпись
sidebar-edit-comment-title = Изменить подпись результата
sidebar-edit-comment-description = Исправьте локально сохраненную подпись. При сохранении кэш переводов этого результата будет очищен.
sidebar-edit-comment-save = Сохранить
sidebar-edit-comment-cancel = Отмена
sidebar-edit-latex = Изменить LaTeX
sidebar-edit-latex-title = Изменить LaTeX формулы
sidebar-edit-latex-description = Измените локально сохранённый исходный код LaTeX. После сохранения обновятся все открытые представления формулы.
sidebar-edit-latex-failed = Не удалось открыть редактор LaTeX: { $message }
sidebar-edit-latex-source = Исходный код LaTeX
sidebar-edit-latex-preview = Предпросмотр
sidebar-edit-latex-invalid = Не удалось отобразить этот LaTeX
sidebar-edit-latex-save = Сохранить
sidebar-edit-latex-cancel = Отмена
sidebar-correct-region = Исправить область
sidebar-correct-region-title = Исправить область результата
sidebar-correct-region-selection = Регулируемая область результата
sidebar-correct-region-reset = Восстановить обнаруженную область
sidebar-correct-region-save = Сохранить
sidebar-correct-region-cancel = Отмена
sidebar-add-to-note = Добавить в заметку
sidebar-remove = Удалить локальный результат
progress-correct-region = Сохранение исправленной области...
progress-correct-region-done = Исправленная область сохранена
note-title = Результаты Zotero Figure

confirm-remove-generated = Удалить из этого PDF все аннотации рисунков и таблиц, созданные Zotero Figure?
confirm-remove-all = Удалить все аннотации из этого PDF? Будут удалены и аннотации, созданные не Zotero Figure.
confirm-remove-one = Удалить этот локальный результат и его аннотацию?

progress-initializing = Инициализация анализа макета...
progress-exporting = [{ $current }/{ $total }] Экспорт страниц PDF
progress-detecting = [{ $current }/{ $total }] Поиск рисунков, таблиц и формул
progress-done = Сохранено локально: { $count }, удалено: { $removed }, пропущено: { $skipped }, синхронизировано аннотаций: { $annotations }; время: { $seconds } с
progress-cancelled = Анализ макета отменен
progress-error = Ошибка: { $message }
progress-add-note = Добавление результатов в заметку...
progress-sync-annotations = Преобразование локальных результатов в аннотации Zotero...
progress-sync-annotations-done = Синхронизировано аннотаций: { $created }, удалено: { $removed }, пропущено: { $skipped }
progress-remove-generated = Удаление созданных аннотаций рисунков...
progress-remove-all = Удаление всех аннотаций...
progress-switch-view = Переключение на представление { $view }...

error-model-file-unavailable = Не удалось подготовить встроенную модель макета. Восстановите ее в настройках Zotero Figure.
error-model-integrity = Установленная копия встроенной модели не прошла проверку размера или SHA-256. Восстановите ее в настройках Zotero Figure.
error-analysis-failed = Не удалось распознать макет на страницах: { $count }. Проверьте файл модели и перезапустите Zotero.
error-formula-api-key-missing = Сначала добавьте ключ API SiliconFlow в настройках PDF Figure.
error-formula-api-http = SiliconFlow вернул HTTP { $status }.
error-formula-api-network = Не удалось подключиться к SiliconFlow.
error-formula-api-timeout = Время ожидания запроса к SiliconFlow истекло.
error-formula-api-response = SiliconFlow не вернул корректный LaTeX.
error-formula-api-failed = Не удалось преобразовать формулу.

model-variant-optimized = Встроенная оптимизированная модель Q8

preferences-restore-model = Восстановить встроенную модель
preferences-cancel-install = Отменить подготовку
preferences-status-preparing = Подготовка встроенной модели...
preferences-status-install-progress = Подготовлено { $loaded } / { $total } ({ $percent }%)
preferences-status-install-cancelled = Подготовка встроенной модели отменена
preferences-status-install-failed = Не удалось подготовить встроенную модель: { $message }
preferences-status-checking = Проверка целостности модели...
preferences-status-check-failed = Не удалось проверить модель: { $message }
preferences-status-missing = Копия встроенной модели еще не подготовлена
preferences-status-invalid = Установленная копия модели не прошла проверку целостности
preferences-status-valid = Проверено: { $name }
preferences-model-expected = Ожидаемый файл: { $size }, SHA-256 { $hash }
preferences-model-invalid-details = Найденный файл: { $size }, SHA-256 { $hash }
preferences-model-valid-details = { $name }, { $size }, SHA-256 { $hash }
preferences-api-status-checking = Проверка выбранной модели SiliconFlow...
preferences-api-status-valid = Ключ проверен; доступно автоматическое распознавание формул.
preferences-api-status-failed = Не удалось проверить ключ: { $message }
preferences-hash-not-computed = не вычислено
preferences-existing-formulae-scanning = Поиск существующих изображений формул…
preferences-existing-formulae-progress = Преобразовано { $completed } из { $total } (успешно: { $succeeded }, ошибок: { $failed })…
preferences-existing-formulae-complete = Обработано формул: { $total } (успешно: { $succeeded }, ошибок: { $failed }).
preferences-existing-formulae-empty = Для всех распознанных формул LaTeX уже сохранён в кэше.
preferences-existing-formulae-failed = Ошибка преобразования: { $message }
preferences-about-version = Версия { $version }
prompt-figure-caption = Подпись рисунка:
