<script setup lang="ts">
import { computed, ref, watch, useTemplateRef } from 'vue'
import IconSend from './components/IconSend.vue'
import { characters, getPrompt } from './lib/prompts'
import { useTextareaRows } from './lib/dom'
import { useUserMedia } from './lib/userMedia'
import { AssistantConfig, AssistantMessageEvent, useAssistant } from './lib/assistant'
import { useWindowFocus } from '@vueuse/core'
import AudioBars from './components/AudioBars.vue'
import Spinner from './components/Spinner.vue'
import IconMic from './components/IconMic.vue'
import IconMicMuted from './components/IconMicMuted.vue'
import IconChat from './components/IconChat.vue'

type Message = {
  id: string
  date: Date
  role: 'user' | 'assistant'
  content: string
}

const filePath = ref('/alice_ch7.pdf')
const selectedCharacter = ref<number | null>(null)
const messages = ref<Message[]>([])
const isLoading = ref(false)
const messageText = ref('')
const typing = ref(false)
const active = ref<'audio' | 'text' | null>('audio')
const ready = ref(false)
const isMuted = ref(false)
const hasStartedConversation = ref(false)
const messagesContainer = useTemplateRef('messagesContainer')

const textarea = useTemplateRef('textarea')
const textareaRows = useTextareaRows(textarea)
const isWindowFocused = useWindowFocus()

const character = computed(() => {
  return characters[selectedCharacter.value] || null
})

const assistantConfig = computed<AssistantConfig>(() => {
  return {
    type: 'realtime',
    model: 'gpt-realtime',
    instructions: character.value ? getPrompt(character.value) : undefined,
    tools: [],
    output_modalities: ['audio'],
    audio: {
      input: {
        transcription: {
          model: 'gpt-4o-mini-transcribe',
        },
      },
      output: {
        voice: character.value?.voice || 'cedar',
      },
    },
  };
})

const {
  stream: audioInput,
  isMuted: isAudioInputMuted,
  start: startAudioInput,
  stop: stopAudioInput,
} = useUserMedia({ audio: true });

const {
  audioOutput,
  ready: assistantReady,
  connect,
  // disconnect,
  sendMessage: sendAssistantMessage,
  resumeConversation,
} = useAssistant(
  assistantConfig,
  import.meta.env.APP_OPENAI_API_KEY,
  audioInput,
  false,
  onMessageEvent,
);

const isAudioMuted = computed(() => {
  return active.value !== 'audio' || !isWindowFocused.value || isMuted.value;
});

const isAssistantEnabled = computed(() => {
  return active.value != null;
});

function onMessageEvent(event: AssistantMessageEvent) {
  if (event.type === 'typing') {
    typing.value = true;
  } else if (event.type === 'message') {
    typing.value = false;

    const msgIndex = messages.value.findIndex(msg => msg.id === event.id);

    if (msgIndex >= 0) {
      messages.value.splice(msgIndex, 1, {
        id: event.id,
        role: event.role,
        date: new Date(),
        content: event.text,
      });
    } else {
      messages.value.push({
        id: event.id,
        role: event.role,
        date: new Date(),
        content: event.text,
      });
    }
  } else if (event.type === 'message_part') {
    typing.value = true;

    const msgIndex = messages.value.findIndex(msg => msg.id === event.id);

    if (msgIndex >= 0) {
      const msg = messages.value[msgIndex];

      messages.value.splice(msgIndex, 1, {
        ...msg,
        role: event.role,
        content: msg.content + event.textDelta,
      });
    } else {
      messages.value.push({
        id: event.id,
        role: event.role,
        date: new Date(),
        content: event.textDelta,
      });
    }
  }
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
}

function sendMessage() {
  const content = messageText.value.trim();
  if (!content) return;

  messages.value.push({
    id: new Date().toISOString(),
    role: 'user',
    date: new Date(),
    content,
  });

  sendAssistantMessage(content);
  messageText.value = '';
}

function scrollToBottom() {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
}

watch(isAssistantEnabled, (value) => {
  if (value) {
    const isFirstCall = !hasStartedConversation.value;
    hasStartedConversation.value = true;

    resumeConversation(isFirstCall
      ? null
      : 'User has returned to the conversation. Please acknowledge their return naturally and be ready to continue helping them. You can briefly greet them and offer to continue dialog from previous topic.'
    );
  }
}, { immediate: true });

watch(isAudioMuted, (value) => {
  isAudioInputMuted.value = value;
}, {
  immediate: true,
});

watch(assistantReady, (value) => {
  ready.value = value;

  if (!value) {
    hasStartedConversation.value = false;
  }
}, {
  immediate: true,
});

watch(active, () => {
  if (active.value) {
    startAudioInput();
  } else {
    stopAudioInput();
  }
}, {
  immediate: true,
});

watch(character, () => {
  connect();
});

watch(
  () => [
    messages.value,
    typing.value
  ],
  () => {
    scrollToBottom();
  }, {
    deep: true,
    flush: 'post',
  }
);
</script>

<template>
  <main class="app">
    <article>
      <iframe :src="filePath" />
    </article>

    <aside>
      <h1>Чат с персонажем книги</h1>

      <div v-if="!character" class="controls">
        <select
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
      </div>

      <div v-if="character" class="chat">
        <div ref="messagesContainer" class="chat-messages">
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
              <div v-if="message.role === 'assistant'" class="chat-message-name">
                {{ character?.name }}
              </div>
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

        <div v-if="active === 'audio'" class="audio">
          <div class="audio-output">
            <audio
              autoplay
              :srcObject="audioOutput"
            />
            <AudioBars
              v-if="ready"
              key="audio"
              :audio="audioOutput"
              bar-color="#000"
              :bar-width="3"
              :bar-gap="4"
              rounded
              class="audio-output-bars"
            />
            <Spinner v-if="!ready" size="sm"/>
          </div>

          <button
            class="audio-input"
            :class="{ 'error': isMuted }"
            @click="isMuted = !isMuted"
          >
            <IconMic
              v-if="!isMuted"
              class="audio-input-icon"
            />
            <IconMicMuted
              v-else
              class="audio-input-icon"
            />
            <transition name="audio-input-bars">
              <AudioBars
                v-if="audioInput && !isMuted"
                :audio="audioInput"
                bar-color="#FFF"
                :bar-count="3"
                :bar-width="4"
                :bar-gap="3"
                rounded
                class="audio-input-bars"
              />
            </transition>
          </button>

          <button class="control-button" @click="active = 'text'">
            <IconChat />
          </button>
        </div>

        <form v-if="active === 'text'" class="chat-input" @submit.prevent="sendMessage">
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

          <button class="control-button" @click="active = 'audio'">
            <IconMic />
          </button>
        </form>
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
  flex: 1 1 60%;
  max-height: 100%;
  min-height: 0;
  overflow: auto;

  @media (max-width: 768px) {
    display: none;
  }
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
  flex: 1 1 35%;
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
  color: var(--color-primary);
  border-color: var(--color-primary);
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

  &.error {
    background-color: var(--color-accent-alarm);
    border-color: var(--color-accent-alarm);
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
  border: 1px solid var(--color-border);
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
  flex-direction: column;
  align-items: start;
  justify-content: start;
  gap: 0.5rem;

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

.chat-message-name {
  display: block;
  font-size: 1.2rem;
  font-weight: 400;
  line-height: 1.5rem;
  color: var(--color-secondary);
}
.chat-message-user .chat-message-name {
  text-align: right;
}

.chat-message-content {
  display: block;
  padding: 1.5rem;
  border-radius: 1.5rem;
  max-width: 85%;

  font-size: 1.4rem;
  font-weight: 400;
  line-height: 2rem;
  color: var(--color-primary);
}
.chat-message-user .chat-message-content {

  align-self: flex-end;
  background-color: var(--color-bg-action);
  border-start-end-radius: 0.1rem;
}
.chat-message-assistant .chat-message-content {
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

.audio {
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

.audio-output {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  flex: 1 1 auto;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  height: 3rem;
  padding: 0.5rem 2rem;
  box-sizing: content-box;
  color: var(--color-primary);
  background-color: var(--color-bg-1);
  border: 1px solid var(--color-border);
  border-radius: 2rem;

  transition: all .2s;

  cursor: pointer;
}

.audio-output-bars {
  width: 100%;
  height: 3rem;
  min-width: 0;
  max-width: 100%;
}

.audio-input {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  min-width: 4rem;
  height: 4rem;
  gap: 4px;
  padding: 0;
  box-sizing: content-box;
  border-radius: 4rem;
  padding: 0 0.5rem;
  border: 1px solid var(--color-accent-action);
  background-color: var(--color-accent-action);
  color: var(--color-on-accent);
  cursor: pointer;
  transition: all .2s;

  &.error {
    background-color: var(--color-accent-alarm);
    border-color: var(--color-accent-alarm);
  }
}

.audio-input-bars {
  width: 100%;
  height: 3rem;
  min-width: 0;
  max-width: 100%;

  &-enter-active,
  &-leave-active {
    transition: all .4s;
  }

  &-enter-from,
  &-leave-to {
    opacity: 0;
    margin-left: -44px;
  }
}

.audio-input-icon {
  flex: 0 0 auto;
  color: var(--color-on-accent);
}

.control-button {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  min-width: 4rem;
  height: 4rem;
  gap: 4px;
  padding: 0;
  box-sizing: content-box;
  border-radius: 4rem;
  padding: 0 0.5rem;
  background-color: var(--color-bg-1);
  color: var(--color-primary);
  border: 1px solid var(--color-border);
  cursor: pointer;
  transition: all .2s;
}
</style>


