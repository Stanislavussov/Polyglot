// A curated emoji set for naming word lists, with English and Russian search words.
// Hand-picked rather than the full Unicode catalogue: that would outweigh the page and bury the useful picks.

export interface EmojiGroup {
  key: string;
  items: { emoji: string; words: string }[];
}

// biome-ignore format: four per line mirrors the picker grid and keeps 300 entries scannable
const RAW: { key: string; items: [emoji: string, words: string][] }[] = [
  {
    key: "study",
    items: [
      ["📚", "books study книги учеба"], ["📖", "book read книга читать"], ["📝", "note write заметка"], ["✏️", "pencil карандаш"],
      ["🖊️", "pen ручка"], ["🖍️", "crayon мелок"], ["📓", "notebook тетрадь"], ["📒", "ledger блокнот"],
      ["📕", "red book книга"], ["📗", "green book книга"], ["📘", "blue book книга"], ["📙", "orange book книга"],
      ["🎓", "school graduate учеба выпуск"], ["🏫", "school школа"], ["🧠", "brain memory мозг память"], ["💡", "idea идея"],
      ["🔤", "letters abc буквы"], ["🔠", "capitals буквы"], ["🔡", "lowercase буквы"], ["🔢", "numbers цифры"],
      ["🗣️", "speak talk говорить"], ["💬", "chat phrase фраза разговор"], ["💭", "thought мысль"], ["🗨️", "speech речь"],
      ["🎯", "goal target цель"], ["⭐", "star favorite избранное звезда"], ["🌟", "glow star звезда"], ["🔥", "fire hot важное огонь"],
      ["✅", "done check готово"], ["❓", "question вопрос"], ["❗", "important важно"], ["📌", "pin закреп"],
      ["🔖", "bookmark закладка"], ["🏷️", "label tag метка"], ["🗂️", "folders папки"], ["📎", "clip скрепка"],
      ["🔍", "search поиск"], ["🧾", "list список"], ["📅", "calendar календарь"], ["⏰", "alarm будильник"],
    ],
  },
  {
    key: "travel",
    items: [
      ["✈️", "plane travel самолет путешествие"], ["🧳", "luggage trip багаж"], ["🗺️", "map карта"], ["🧭", "compass компас"],
      ["🏖️", "beach пляж"], ["🏝️", "island остров"], ["🏔️", "mountain горы"], ["🌋", "volcano вулкан"],
      ["🚆", "train поезд"], ["🚇", "metro метро"], ["🚌", "bus автобус"], ["🚕", "taxi такси"],
      ["🚗", "car машина"], ["🚲", "bike велосипед"], ["🛳️", "ship корабль"], ["⛵", "sail парусник"],
      ["🏨", "hotel отель"], ["🏛️", "museum музей"], ["🏰", "castle замок"], ["🗼", "tower башня"],
      ["🗽", "liberty статуя"], ["🌍", "world europe africa мир"], ["🌎", "americas мир"], ["🌏", "asia мир"],
      ["⛺", "camping кемпинг"], ["🛂", "passport паспорт"], ["🎫", "ticket билет"], ["📸", "photo фото"],
    ],
  },
  {
    key: "life",
    items: [
      ["🏠", "home дом"], ["🏡", "house дом сад"], ["🏢", "office офис"], ["💼", "work job работа"],
      ["💻", "computer it компьютер"], ["📱", "phone телефон"], ["⌨️", "keyboard клавиатура"], ["🖥️", "desktop монитор"],
      ["🛒", "shopping покупки"], ["🛍️", "bags покупки"], ["💳", "card карта"], ["💰", "money деньги"],
      ["🏦", "bank банк"], ["📈", "growth рост"], ["🩺", "doctor health врач"], ["💊", "pill лекарство"],
      ["🏥", "hospital больница"], ["🚑", "ambulance скорая"], ["👶", "baby ребенок"], ["👨‍👩‍👧", "family семья"],
      ["❤️", "love любовь"], ["💌", "letter письмо любовь"], ["🎁", "gift подарок"], ["🎉", "party праздник"],
      ["🎂", "birthday день рождения"], ["💍", "ring кольцо"], ["👗", "dress clothes одежда"], ["👟", "shoes обувь"],
      ["🧹", "cleaning уборка"], ["🛏️", "bed кровать"], ["🚿", "shower душ"], ["🧺", "laundry стирка"],
    ],
  },
  {
    key: "food",
    items: [
      ["🍎", "apple яблоко"], ["🍌", "banana банан"], ["🍇", "grapes виноград"], ["🍓", "strawberry клубника"],
      ["🍉", "watermelon арбуз"], ["🍋", "lemon лимон"], ["🍑", "peach персик"], ["🍒", "cherry вишня"],
      ["🥑", "avocado авокадо"], ["🥕", "carrot морковь"], ["🥦", "broccoli брокколи"], ["🍅", "tomato помидор"],
      ["🥐", "croissant круассан"], ["🍞", "bread хлеб"], ["🧀", "cheese сыр"], ["🥚", "egg яйцо"],
      ["🍳", "cooking кухня"], ["🍕", "pizza пицца еда"], ["🍔", "burger бургер"], ["🍝", "pasta паста"],
      ["🍣", "sushi суши"], ["🍜", "noodles лапша"], ["🥗", "salad салат"], ["🍲", "soup суп"],
      ["🍰", "cake торт"], ["🍫", "chocolate шоколад"], ["🍦", "ice cream мороженое"], ["🍪", "cookie печенье"],
      ["☕", "coffee кофе"], ["🍵", "tea чай"], ["🍷", "wine вино"], ["🍺", "beer пиво"],
    ],
  },
  {
    key: "animals",
    items: [
      ["🐶", "dog собака"], ["🐱", "cat кошка"], ["🐭", "mouse мышь"], ["🐰", "rabbit кролик"],
      ["🦊", "fox лиса"], ["🐻", "bear медведь"], ["🐼", "panda панда"], ["🐨", "koala коала"],
      ["🐯", "tiger тигр"], ["🦁", "lion лев"], ["🐮", "cow корова"], ["🐷", "pig свинья"],
      ["🐸", "frog лягушка"], ["🐵", "monkey обезьяна"], ["🐔", "chicken курица"], ["🐧", "penguin пингвин"],
      ["🦉", "owl сова"], ["🦄", "unicorn единорог"], ["🐴", "horse лошадь"], ["🐢", "turtle черепаха"],
      ["🐍", "snake змея"], ["🐙", "octopus осьминог"], ["🐬", "dolphin дельфин"], ["🐳", "whale кит"],
      ["🦋", "butterfly бабочка"], ["🐝", "bee пчела"], ["🐞", "ladybug божья коровка"], ["🦜", "parrot попугай"],
    ],
  },
  {
    key: "nature",
    items: [
      ["🌱", "plant growth растение"], ["🌿", "herb трава"], ["🍀", "clover luck удача клевер"], ["🌵", "cactus кактус"],
      ["🌸", "flower цветок"], ["🌷", "tulip тюльпан"], ["🌹", "rose роза"], ["🌻", "sunflower подсолнух"],
      ["🌳", "tree дерево"], ["🌲", "pine ель"], ["🍂", "autumn осень"], ["🍁", "maple клен"],
      ["☀️", "sun summer солнце лето"], ["⛅", "cloud облако"], ["🌧️", "rain дождь"], ["⛈️", "storm гроза"],
      ["❄️", "winter snow зима снег"], ["⛄", "snowman снеговик"], ["🌈", "rainbow радуга"], ["⚡", "lightning молния"],
      ["🌊", "sea wave море"], ["💧", "water вода"], ["🌙", "moon night луна"], ["🪐", "planet планета"],
    ],
  },
  {
    key: "activities",
    items: [
      ["⚽", "football soccer футбол спорт"], ["🏀", "basketball баскетбол"], ["🎾", "tennis теннис"], ["🏐", "volleyball волейбол"],
      ["🏓", "ping pong пинг-понг"], ["🏸", "badminton бадминтон"], ["⛳", "golf гольф"], ["🏊", "swim плавание"],
      ["🚴", "cycling велоспорт"], ["🏃", "run бег"], ["🧘", "yoga йога"], ["🏋️", "gym спортзал"],
      ["⛷️", "ski лыжи"], ["🏂", "snowboard сноуборд"], ["🧗", "climbing скалолазание"], ["🥊", "boxing бокс"],
      ["🎵", "music музыка"], ["🎸", "guitar гитара"], ["🎹", "piano пианино"], ["🎤", "sing петь"],
      ["🎬", "movie кино"], ["📺", "tv телевизор"], ["🎮", "game игры"], ["🎲", "dice кости игра"],
      ["♟️", "chess шахматы"], ["🎨", "art painting искусство"], ["📷", "camera камера"], ["🧶", "knitting вязание"],
    ],
  },
  {
    key: "objects",
    items: [
      ["🔑", "key ключ"], ["🔒", "lock замок"], ["🛠️", "tools инструменты"], ["🔧", "wrench ключ"],
      ["⚙️", "settings настройки"], ["🧲", "magnet магнит"], ["🔬", "microscope наука"], ["🔭", "telescope телескоп"],
      ["🧪", "chemistry химия"], ["💾", "save сохранить"], ["📦", "box коробка"], ["✉️", "mail письмо"],
      ["📮", "post почта"], ["📰", "news новости"], ["🗞️", "newspaper газета"], ["🕰️", "clock часы"],
      ["⌛", "time время"], ["💎", "gem diamond алмаз"], ["👑", "crown корона"], ["🎈", "balloon шарик"],
      ["🪴", "pot plant растение"], ["🕯️", "candle свеча"], ["🧸", "teddy игрушка"], ["🚀", "rocket ракета"],
    ],
  },
  {
    key: "faces",
    items: [
      ["😀", "smile улыбка"], ["😊", "happy счастье"], ["😎", "cool крутой"], ["🤓", "nerd ботаник"],
      ["🥳", "party праздник"], ["😍", "love любовь"], ["🤔", "think думать"], ["😴", "sleep сон"],
      ["😅", "phew пот"], ["😂", "laugh смех"], ["🙃", "upside вверх ногами"], ["😇", "angel ангел"],
      ["🤩", "wow вау"], ["😤", "determined упорство"], ["🤯", "mind blown шок"], ["🥶", "cold холод"],
      ["👋", "hello привет"], ["👍", "like ок"], ["👏", "clap браво"], ["🙌", "hooray ура"],
      ["💪", "strong сила"], ["🤝", "deal сделка"], ["🙏", "thanks спасибо"], ["✌️", "peace мир"],
    ],
  },
  {
    key: "symbols",
    items: [
      ["🟢", "green зеленый"], ["🔵", "blue синий"], ["🟣", "purple фиолетовый"], ["🟡", "yellow желтый"],
      ["🟠", "orange оранжевый"], ["🔴", "red красный"], ["🟤", "brown коричневый"], ["⚫", "black черный"],
      ["🟩", "green square зеленый"], ["🟦", "blue square синий"], ["🟪", "purple square фиолетовый"], ["🟨", "yellow square желтый"],
      ["💚", "green heart сердце"], ["💙", "blue heart сердце"], ["💜", "purple heart сердце"], ["🧡", "orange heart сердце"],
      ["♻️", "recycle повтор"], ["🔁", "repeat повтор"], ["➕", "plus плюс"], ["✨", "sparkles блеск"],
      ["🧩", "puzzle пазл"], ["🔔", "bell колокол"], ["🆕", "new новое"], ["🆗", "ok ок"],
    ],
  },
  {
    key: "flags",
    items: [
      ["🇬🇧", "english uk английский англия"], ["🇺🇸", "usa america америка"], ["🇩🇪", "german германия немецкий"], ["🇫🇷", "french франция французский"],
      ["🇪🇸", "spanish испания испанский"], ["🇮🇹", "italian италия итальянский"], ["🇵🇹", "portuguese португалия"], ["🇧🇷", "brazil бразилия"],
      ["🇨🇿", "czech чехия чешский"], ["🇵🇱", "polish польша польский"], ["🇺🇦", "ukraine украина"], ["🇷🇺", "russia россия русский"],
      ["🇰🇿", "kazakhstan казахстан"], ["🇸🇰", "slovakia словакия"], ["🇳🇱", "dutch нидерланды"], ["🇸🇪", "sweden швеция"],
      ["🇫🇮", "finland финляндия"], ["🇳🇴", "norway норвегия"], ["🇹🇷", "turkey турция"], ["🇬🇷", "greece греция"],
      ["🇯🇵", "japan япония"], ["🇨🇳", "china китай"], ["🇰🇷", "korea корея"], ["🇮🇳", "india индия"],
    ],
  },
];

export const EMOJI_GROUPS: EmojiGroup[] = RAW.map((group) => ({
  key: group.key,
  items: group.items.map(([emoji, words]) => ({ emoji, words })),
}));
