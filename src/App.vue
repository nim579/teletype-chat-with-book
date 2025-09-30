<script setup lang="ts">
import { computed, ref, watch, reactive } from 'vue'
import OpenAI from 'openai'
import IconSend from './components/IconSend.vue'
import Spinner from './components/Spinner.vue'

type Character = {
  name: string
  gender: string
  role: string
  voice_description: string
  notes: string
}

type History = {
  conversation_id: string
  typing: boolean
  messages: { role: 'user' | 'assistant', content: string, date: Date }[]
}

const openai = new OpenAI({ apiKey: import.meta.env.APP_OPENAI_API_KEY, dangerouslyAllowBrowser: true })

const vsId = ref(import.meta.env.APP_DEFAULT_FILE_ID)
const filePath = ref('/alice_ch7.pdf')
const isLoading = ref<string | null>(null)
const characters = ref<Character[] | null>(null)
const selectedCharacter = ref<number | null>(null)
const messageText = ref('')
const textarea = ref<HTMLTextAreaElement | null>(null)
const history = reactive(new Map<number, History>())

const character = computed(() => characters.value?.[selectedCharacter.value])

const messages = computed(() => history.get(selectedCharacter.value)?.messages)
const typing = computed(() => history.get(selectedCharacter.value)?.typing)

const textareaRows = computed(() => {
  if (!messageText.value) return 1;

  const text = messageText.value;
  const maxRows = 3;

  // Подсчитываем явные переносы строк
  const explicitLineBreaks = (text.match(/\n/g) || []).length;
  let totalRows = explicitLineBreaks + 1;

  // Если есть доступ к textarea, учитываем автоматические переносы
  if (textarea.value) {
    const style = window.getComputedStyle(textarea.value);
    const paddingLeft = parseFloat(style.paddingLeft);
    const paddingRight = parseFloat(style.paddingRight);
    const textareaWidth = textarea.value.clientWidth - paddingLeft - paddingRight;

    // Создаем временный элемент для измерения ширины текста
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    if (context) {
      context.font = style.font;

      // Разбиваем текст на строки и проверяем каждую
      const lines = text.split('\n');
      totalRows = 0;

      for (const line of lines) {
        if (line === '') {
          totalRows += 1;
        } else {
          const textWidth = context.measureText(line).width;
          const wrappedLines = Math.ceil(textWidth / textareaWidth) || 1;
          totalRows += wrappedLines;
        }
      }
    }
  }

  return Math.min(totalRows, maxRows);
});


const charactersSchema = {
  "type": "object",
  "properties": {
    "text_name": {
      "type": "string",
      "description": "Название или заголовок текста"
    },
    "characters": {
      "type": "array",
      "description": "Список основных персонажей в тексте. Только один персонаж на имя",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "description": "Имя персонажа на русском языке без имени на языке оригинала"
          },
          "gender": {
            "type": "string",
            "description": "Пол персонажа (мужской, женский, небинарный и т.д.)"
          },
          "role": {
            "type": "string",
            "description": "Роль персонажа в тексте"
          },
          "voice_description": {
            "type": "string",
            "description": "Описание голоса персонажа, его голосовой манеры или тональности"
          },
          "notes": {
            "type": "string",
            "description": "Дополнительные заметки, которые помогают понять поведение, мотивацию и характеристики персонажа"
          }
        },
        "required": [
          "name",
          "gender",
          "role",
          "voice_description",
          "notes"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "text_name",
    "characters"
  ],
  "additionalProperties": false
};

const handleFileChange = async (event: Event) => {
  characters.value = null;
  selectedCharacter.value = null;

  const file = (event.target as HTMLInputElement).files?.[0]

  if (file) {
    isLoading.value = 'update';

    filePath.value = URL.createObjectURL(file)

    const vs = await openai.vectorStores.create({});
    await openai.vectorStores.fileBatches.uploadAndPoll(vs.id, { files: [file] });

    vsId.value = vs.id;

    generateCharacters('update');
  }
}

const generateCharacters = async (mode: 'generate' | 'update') => {
  isLoading.value = mode

  const response = await openai.responses.parse({
    model: 'gpt-5-mini',
    tools: [{ type: "file_search", vector_store_ids: [vsId.value] }],
    reasoning: {
      effort: 'low',
    },
    text: {
      format: {
        type: 'json_schema',
        name: 'characters',
        schema: charactersSchema,
      },
    },
    input: [
      {
        role: 'system',
        content: 'Выведи список персонажей из данного текста. Не выводи лишние персонажи, только те, которые есть в тексте. Не выводи персонажи, о которых мало данных, массовку или третьестепенные персонажи.'
      },
    ],
  });

  characters.value = (response.output_parsed as any).characters;

  isLoading.value = null
}

const handleMessageSubmit = async () => {
  if (isLoading.value) return

  const conversation = history.get(selectedCharacter.value)
  if (!conversation) return

  const inputText = messageText.value
  messageText.value = ''

  conversation.typing = true

  conversation.messages.push({
    role: 'user',
    content: inputText,
    date: new Date(),
  })

  const response = await openai.responses.create({
    model: 'gpt-5-mini',
    conversation: conversation.conversation_id,
    tools: [{ type: "file_search", vector_store_ids: [vsId.value] }],
    reasoning: {
      effort: 'low',
    },
    input: [
      {
        role: 'user',
        content: inputText,
      },
    ],
  });

  conversation.messages.push({
    role: 'assistant',
    content: response.output_text,
    date: new Date(),
  })

  conversation.typing = false
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleMessageSubmit();
  }
}

watch(character, async () => {
  if (history.has(selectedCharacter.value)) {
    return
  }

  const conversation = await openai.conversations.create({
    items: [
      {
        role: 'system',
        content: `
Вы - персонаж книги. Отвечай на вопросы пользователя.
Данные о книге можешь искать в векторном хранилище.
Ваше имя: ${character.value?.name}
Ваш пол: ${character.value?.gender}
Ваша роль: ${character.value?.role}
Ваше описание: ${character.value?.voice_description}
Ваши заметки: ${character.value?.notes}
        `,
      },
    ],
  })

  if (selectedCharacter.value != null) {
    history.set(selectedCharacter.value, { conversation_id: conversation.id, typing: false, messages: [] })
  }
})
</script>

<template>
  <main class="app">
    <article>
      <iframe :src="filePath" />
    </article>

    <aside>
      <h1>Чат с персонажем книги</h1>

      <div class="controls">
        <button
          v-if="!characters"
          class="button"
          :class="{ 'main': !isLoading }"
          :disabled="!!isLoading"
          @click="generateCharacters('generate')"
        >{{ isLoading === 'generate' ? 'Готовим список персонажей...' : 'Старт' }}</button>

        <select
          v-else
          v-model="selectedCharacter"
          class="button"
        >
          <option :value="null">Выберите персонажа</option>
          <option
            v-for="(character, index) in characters"
            :key="character.name"
            :value="index"
          >
            {{ character.name }}
          </option>
        </select>

        <label v-if="!isLoading" class="button">
          <input type="file" accept="application/pdf" @change="handleFileChange" />
          <span>{{ isLoading === 'update' ? 'Готовим список персонажей...' : 'Свой текст' }}</span>
        </label>
      </div>

      <div v-if="character" class="chat">
        <template v-if="messages">
          <div class="chat-messages">
            <TransitionGroup name="chat-message">
              <div
                v-for="message in messages"
                :key="message.date.getTime()"
                class="chat-message"
                :class="{
                  'chat-message-user': message.role === 'user',
                  'chat-message-assistant': message.role === 'assistant',
                }"
              >
                <div class="chat-message-content">
                  {{ message.content }}
                </div>
              </div>

              <div v-if="typing" key="_typing_" class="chat-typing">
                <div class="chat-typing-text">
                  Набирает ответ...
                </div>
              </div>
            </TransitionGroup>
          </div>
          <form class="chat-input" @submit.prevent="handleMessageSubmit">
            <textarea
              v-model="messageText"
              ref="textarea"
              class="chat-textarea"
              :rows="textareaRows"
              placeholder="Напишите сообщение..."
              @keydown="onKeyDown"
            />
            <button class="chat-button" :disabled="!!isLoading" title="Отправить сообщение" type="submit">
              <IconSend />
            </button>
          </form>
        </template>
        <Spinner
          v-else
          central
          class="chat-spinner"
        />
      </div>
    </aside>
  </main>
</template>

<style lang="scss" scoped>
.app {
  display: flex;
  flex-direction: row;
  height: 100%;
  min-height: 100%;
}

article {
  flex: 1 1 70%;
  max-height: 100%;
  min-height: 0;
  overflow: auto;
}

iframe {
  width: 100%;
  height: 100%;
  border: none;
}

aside {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  flex: 1 1 30%;
  border-left: 1px solid var(--color-divider);
  padding: 2.5rem 1.5rem;
  box-sizing: border-box;
  max-height: 100%;
  min-height: 0;
  overflow: auto;

  h1 {
    display: block;
    flex: 0 0 auto;
    margin: 0 0 0.5em;
    font-size: 3rem;
    font-weight: 800;
    color: var(--color-primary);
  }
}

.button {
  position: relative;
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  margin: 0 10px 0 0;
  padding: 0 25px;
  box-sizing: border-box;
  border-width: 1px;
  border-style: solid;
  border-radius: 7px;
  background-color: var(--color-bg-1);
  color: var(--color-primary, #1A1919);
  border-color: var(--color-primary, #1A1919);
  outline: 0;
  box-shadow: none;
  font-family: Inter, Helvetica Neue, Helvetica, sans-serif;
  font-stretch: normal;
  font-weight: 600;
  font-style: normal;
  font-size: 1.3rem;
  line-height: 1.4em;
  text-decoration: none;
  cursor: pointer;
  transform: translateZ(0);
  transition: all .4s;
  -webkit-user-select: none;
  -moz-user-select: none;
  user-select: none;

  input[type="file"] {
    position: absolute;
    appearance: none;
    opacity: 0.1;
    width: 1px;
    height: 1px;
    top: 0;
    left: 0;
    cursor: pointer;
  }
}
.button:disabled,
.button.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.button.main {
  color: var(--color-on-accent, #FFFFFF);
  background-color: var(--color-accent-action, #5B41F5);
  border-color: var(--color-accent-action, #5B41F5);
}

.controls {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  justify-content: start;
  flex: 0 0 auto;
  gap: 0.5rem;
}

.chat {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  overflow: auto;
  max-height: 100%;
  min-height: 0;
  border: 1px solid var(--color-divider);
  border-radius: 1rem 1rem 4rem 4rem;
  box-sizing: border-box;

  &-messages {
    position: relative;
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 1rem;
    overflow: auto;
    max-height: 100%;
    min-height: 0;
    padding: 1rem 1rem 2rem;

    &::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      display: block;
      height: 1rem;
      width: 100%;
      background: linear-gradient(to top, var(--color-bg-1), transparent);
    }
  }
}

.chat-input {
  display: flex;
  flex-direction: row;
  align-items: end;
  justify-content: start;
  gap: 0.5em;
  margin: 1rem;
  padding: 0.5em;
  box-sizing: border-box;
  border-radius: 3rem;
  background-color: var(--color-bg-2);
}
.chat-textarea {
  flex: 1 1 auto;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  padding: 1.25rem 2rem;
  box-sizing: border-box;
  font-weight: 400;
  font-size: 1.5rem;
  line-height: 1em;
  color: var(--color-primary);
  outline: none;
  resize: none;
  background-color: var(--color-bg-1);
  border: 1px solid var(--color-divider);
  border-radius: 2rem;

  transition: all .2s;

  &:focus {
    border-color: var(--color-accent-action);
  }
}
.chat-button {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 4rem;
  height: 4rem;
  padding: 0;
  box-sizing: content-box;
  border-radius: 4rem;
  border: 1px solid var(--color-accent-action);
  background-color: var(--color-accent-action);
  color: var(--color-on-accent);
  cursor: pointer;
  transition: all .2s;
}

.chat-message {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: start;
  gap: 0.5rem;
  padding: 1.5rem;
  border-radius: 1.5rem;
  max-width: 85%;

  font-size: 1.4rem;
  font-weight: 400;
  line-height: 2rem;
  color: var(--color-primary);

  &-enter-active {
    transition: all .2s;
  }

  &-enter-from {
    opacity: 0;
    transform: translateY(1rem);
  }

  &:first-child {
    margin-top: auto;
  }
}
.chat-message-user {
  align-self: flex-end;
  background-color: var(--color-bg-3);
  border-start-end-radius: 0.1rem;
}
.chat-message-assistant {
  align-self: flex-start;
  background-color: var(--color-bg-2);
  border-start-start-radius: 0.1rem;
}
.chat-typing {
  display: flex;
  flex: 0 0 auto;
  flex-direction: row;
  align-items: center;

  color: #667085;
  gap: 0.5rem;
  padding: 1.5rem;

  &-text {
    font-size: 1.4rem;
    font-weight: 400;
    line-height: 2rem;

    background: linear-gradient(90deg, #98A2B3 25%, #F2F4F7 50%, #98A2B3 75%);
    background-size: 200% auto;
    background-clip: text;

    color: transparent;

    animation: shimmer 1.5s infinite linear;

    @keyframes shimmer {
      0% {
        background-position: 100% 0;
      }

      100% {
        background-position: -100% 0;
      }
    }
  }

  &:first-child {
    margin-top: auto;
  }
}
.chat-spinner {
  color: var(--color-secondary);
}
</style>


