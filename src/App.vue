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
import IconAudio from './components/IconAudio.vue'
import AudioRipples from './components/AudioRipples.vue'
import book from './assets/text.json'
import { createAudioVisualization } from './lib/audioVisualizer'

type Message = {
  id: string
  date: Date
  role: 'user' | 'assistant'
  content: string
}


const selectedCharacter = ref<number | null>(null)
const messages = ref<Message[]>([])
const messageText = ref('')
const typing = ref(false)
const active = ref<'audio' | 'text' | null>('audio')
const ready = ref(false)
const isMuted = ref(false)
const hasStartedConversation = ref(false)
const messagesContainer = useTemplateRef('messagesContainer')
const chooseCharacterVideo = useTemplateRef('chooseCharacterVideo')
const audioAvatarSpeaking = ref(0);

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
    output_modalities: character.value
      ? ['audio']
      : ['text'],
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

const assets = import.meta.glob('./assets/**/*.{png,jpg,jpeg,webp,svg,gif,avif,mp4}', {
  eager: true,
  as: 'url',
});

function getAssetUrl(path: string) {
  return assets[`./assets/${path}`] || `@/assets/${path}`;
}

function characterVideoStart(index: number) {
  const video = chooseCharacterVideo.value?.[index];
  if (!video) return;

  video.play();
}

function characterVideoStop(index: number) {
  const video = chooseCharacterVideo.value?.[index];
  if (!video) return;

  video.pause();
  video.currentTime = 0;
}

watch(isAssistantEnabled, (value) => {
  if (value) {
    const isFirstCall = !hasStartedConversation.value;
    hasStartedConversation.value = true;

    resumeConversation(isFirstCall
      ? null
      : 'Пользователь вернулся к разговору. Поприветствуй его естественно и будь готов продолжить диалог.'
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
  if (character.value) {
    connect();
  }
}, {
  immediate: true,
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

let audioSpeaking = null;

watch(audioOutput, () => {
  if (audioSpeaking) {
    audioSpeaking.stop();
  }

  if (audioOutput.value) {
    audioSpeaking = createAudioVisualization(audioOutput.value, 3, 4, 3);

    audioSpeaking.onUpdate((values: number[]) => {
      audioAvatarSpeaking.value = values[0];
    });
  }
});
</script>

<template>
  <main class="app">
    <aside class="book">
      <div class="book-cover">
        <img src="@/assets/cover.png">
        <video
          src="@/assets/cover.mp4"
          muted
          loop
          autoplay
          playsinline
          preload="auto"
        />
      </div>
      <h2>Гарри Поттер и&nbsp;Капюшон, Который Всегда Сползает</h2>
    </aside>

    <article>
      <p
        v-for="(paragraph, index) in book.text"
        :key="index"
        v-html="paragraph"
      />
    </article>

    <aside class="content">
      <transition name="main" mode="out-in">
        <div v-if="!character" key="choose" class="choose">
          <h1>Поговорите с персонажами книги</h1>

          <div class="choose-characters">
            <label>Выберите персонажа</label>

            <div class="choose-characters-list">
              <button
                v-for="(character, index) in characters"
                :key="character.name"
                :value="index"
                class="choose-character"
                @click="selectedCharacter = index"
                @mouseenter="characterVideoStart(index)"
                @mouseleave="characterVideoStop(index)"
              >
                <div class="choose-character-avatar">
                  <video
                    ref="chooseCharacterVideo"
                    :src="getAssetUrl(character.cover)"
                    :poster="getAssetUrl(character.avatar)"
                    muted
                    loop
                    playsinline
                    preload="auto"
                  />
                </div>

                <div class="choose-character-name">
                  {{ character.name }}
                </div>
              </button>
            </div>
          </div>
        </div>

        <div v-else-if="active === 'audio'" key="audio" class="audio">
          <div class="audio-character">
            <AudioRipples
              :level="audioAvatarSpeaking"
              :size="145"
              :ring-count="5"
              color="#5B41F5"
            >
              <div class="audio-character-avatar">
                <video
                  :src="getAssetUrl(character.cover)"
                  muted
                  loop
                  playsinline
                  autoplay
                  preload="auto"
                />
              </div>
            </AudioRipples>

            <div class="audio-character-name">
              {{ character?.name }}
            </div>
          </div>

          <div class="audio-controls">
            <button
              class="button"
              :class="{ 'error': isMuted }"
              :disabled="!ready"
              @click="isMuted = !isMuted"
            >
              <transition name="audio-controls-icon" mode="out-in">
                <IconMic
                  v-if="!isMuted"
                  key="mic"
                  class="audio-controls-icon"
                />
                <IconMicMuted
                  v-else
                  key="muted"
                  class="audio-controls-icon"
                />
              </transition>
              <transition name="audio-viz">
                <AudioBars
                  v-if="audioInput && !isMuted && ready"
                  key="bars"
                  :audio="audioInput"
                  :bar-count="3"
                  :bar-width="4"
                  :bar-gap="3"
                  rounded
                  class="audio-viz"
                />
              </transition>
            </button>

            <div class="button main">
              <div class="button-ai" />

              <div class="button-content">
                <audio
                  autoplay
                  :srcObject="audioOutput"
                />
                <AudioBars
                  v-if="ready"
                  key="audio"
                  :audio="audioOutput"
                  :bar-width="3"
                  :bar-gap="4"
                  rounded
                  class="audio-viz main"
                />
                <Spinner v-if="!ready" size="sm"/>
              </div>
            </div>

            <button class="button" @click="active = 'text'">
              <IconChat />
            </button>
          </div>
        </div>

        <div v-else-if="active === 'text'" key="chat" class="chat">
          <div class="chat-messages">
            <div v-if="ready" ref="messagesContainer" class="chat-messages-list">
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
                  <img
                    v-if="message.role === 'assistant'"
                    :src="getAssetUrl(character.avatar)"
                    :alt="character.name"
                    class="chat-message-avatar"
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
            <div v-else class="chat-messages-loading">
              <Spinner size="lg"/>
            </div>
          </div>

          <div class="chat-controls">
            <button class="button" @click="active = 'audio'">
              <IconAudio />
            </button>

            <form class="chat-form" @submit.prevent="sendMessage">
              <textarea
                v-model="messageText"
                ref="textarea"
                :rows="textareaRows"
                :disabled="!ready"
                placeholder="Напишите сообщение..."
                @keydown="onKeyDown"
              />
              <button type="submit">
                <IconSend />
              </button>
            </form>
          </div>
        </div>
      </transition>
    </aside>
  </main>
</template>

<style lang="scss" scoped>
.app {
  display: grid;
  grid-template-columns: calc(144px + 30px * 2) 1fr [chat] minmax(360px, 35%);
  height: 100%;
  min-height: 100%;
  background-color: var(--color-bg-2);

  @media (max-width: 900px) {
    grid-template-columns: 1fr 1fr [chat] 2fr;
  }

  @media (max-width: 680px) {
    grid-template-columns: [chat] 1fr;
    grid-template-rows: min-content 1fr;
  }
}

.book {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: start;
  padding: 30px;
  box-sizing: border-box;
  gap: 1.5rem;

  h2 {
    display: block;
    margin: 0;
    font-size: 1.3rem;
    font-weight: 400;
    line-height: normal;
    color: var(--color-primary);
    text-align: center;
  }

  @media (max-width: 900px) {
    grid-column: 1 / span 2;
    background-color: var(--color-bg-1);
  }

  @media (max-width: 680px) {
    grid-column: 1 / -1;
    padding: 20px;
  }
}

.book-cover {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
  width: 100%;
  max-width: 144px;
  border-radius: 4px;
  overflow: hidden;
  box-shadow: 0 4px 16px 0 rgba(0, 0, 0, 0.25);

  img {
    position: relative;
    width: 100%;
    height: auto;
    object-fit: cover;
    vertical-align: top;
    z-index: 1;
  }

  video {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

article {
  display: block;
  padding: 70px 65px;
  box-sizing: border-box;
  height: 100%;
  background-color: var(--color-bg-1);
  overflow: auto;

  p {
    display: block;
    max-width: 540px;
    font-family: Georgia, serif;
    font-size: 1.7rem;
    font-weight: 400;
    line-height: 1.4em;
    color: var(--color-primary);
    text-align: justify;
    margin: 0.5em auto;

    &:first-child {
      margin-top: 0;
    }

    &:last-child {
      margin-bottom: 0;
    }
  }

  @media (max-width: 1140px) {
    padding: 30px;
  }

  @media (max-width: 900px) {
    grid-column: 1 / span 2;
  }

  @media (max-width: 680px) {
    display: none;
  }
}

.content {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  max-height: 100%;
  min-height: 0;

  grid-column-start: chat;
  grid-row: 1 / -1;

  @media (max-width: 680px) {
    grid-row: unset;
  }
}

.content-enter-active,
.content-leave-active {
  transition: all .2s;
}
.content-enter-from,
.content-leave-to {
  opacity: 0;
}

.choose {
  display: grid;
  grid-template-rows: 1fr max-content 1fr;
  flex: 1 1 auto;
  align-items: center;
  align-content: center;
  justify-content: center;
  gap: 1rem;
  box-sizing: border-box;

  h1 {
    display: block;
    margin: 0 auto;
    padding: 0 24px;
    max-width: 320px;
    font-size: 3.2rem;
    font-weight: 500;
    line-height: 1.1em;
    text-align: center;
    color: var(--color-primary);
  }
}

.choose-characters {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3rem;
  box-sizing: border-box;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;

  label {
    display: block;
    padding: 0 24px;
    font-size: 1.7rem;
    font-weight: 500;
    line-height: 1.4em;
    text-align: center;
    color: var(--color-secondary);
  }
}

.choose-characters-list {
  display: flex;
  flex-direction: row;
  align-items: start;
  justify-content: start;
  max-width: 100%;
  min-width: 0;
  gap: 1rem;
  padding: 5px 4rem;
  box-sizing: border-box;
  overflow: auto;
}

.choose-character {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: start;
  gap: 2rem;
  padding: 0;
  margin: 0;
  border: 0;
  background: transparent;

  cursor: pointer;
}

.choose-character-avatar {
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  flex: 0 0 auto;
  width: 145px;
  height: 145px;
  padding: 0;
  margin: 0;
  border: 0;
  border-radius: 145px;

  video {
    position: relative;
    width: 100%;
    height: 100%;
    object-fit: cover;
    vertical-align: top;
    border-radius: 100%;
    z-index: 1;
  }

  &::after {
    content: '';
    position: absolute;
    top: -5px;
    left: -5px;
    right: -5px;
    bottom: -5px;
    border-radius: 100%;
    border: 2px solid transparent;
    background: linear-gradient(var(--color-bg-2), var(--color-bg-2)) content-box,
      linear-gradient(180deg, #5B41F5 0%, #9888F5 100%) no-repeat border-box;

    opacity: 0;
    transform: scale(0.9);
    transition: all .2s;
  }
}

.choose-character-name {
  display: block;
  font-size: 1.5rem;
  font-weight: 500;
  line-height: 1.4em;
  color: var(--color-primary);
  text-align: center;
  transition: all .2s;
}

.choose-character:hover .choose-character-avatar::after {
  opacity: 1;
  transform: scale(1);
}

.choose-character:hover .choose-character-name {
  color: var(--color-accent-action);
}

.audio {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: end;
  flex: 1 1 auto;
  gap: 2rem;
  box-sizing: border-box;
  padding: 2.4rem;
}

.audio-character {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: start;
  margin: auto;
  gap: 4rem;
  box-sizing: border-box;
}

.audio-character-avatar {
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 145px;
  height: 145px;
  padding: 0;
  margin: 0;
  border: 0;
  border-radius: 145px;

  video {
    position: relative;
    width: 100%;
    height: 100%;
    object-fit: cover;
    vertical-align: top;
    border-radius: 100%;
    z-index: 1;
  }
}

.audio-character-name {
  display: block;
  padding: 0.5em 1em;
  border-radius: 1.5em;
  background-color: var(--color-bg-1);
  font-size: 1.5rem;
  font-weight: 500;
  line-height: 1.4em;
  color: var(--color-accent-action);
}

.button {
  position: relative;
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  height: 48px;
  min-width: 80px;
  margin: 0;
  padding: 0.5rem 1rem;
  gap: 4px;
  box-sizing: border-box;

  border: 1px solid var(--color-border);
  border-radius: 48px;
  background-color: var(--color-bg-1);

  color: var(--color-accent-action);
  outline: 0;
  box-shadow: none;

  font-family: Inter, Helvetica Neue, Helvetica, sans-serif;
  font-stretch: normal;
  font-weight: 600;
  font-style: normal;
  font-size: 1.3rem;
  line-height: 1.4em;
  text-decoration: none;
  text-align: center;

  cursor: pointer;
  transition: all .4s;
  -webkit-user-select: none;
  -moz-user-select: none;
  user-select: none;

  &.error {
    color: var(--color-accent-alarm);
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}
.button.main {
  flex-grow: 1;
  max-width: 100%;
  padding-left: 3rem;
  padding-right: 3rem;
}
.button-content {
  position: relative;
  width: 100%;
  min-width: 0;
  z-index: 1;
}

.button-ai {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: conic-gradient(from 180deg at 50% 50%, #C686FF -27.34deg, #FF5C5F 60.24deg, #FFFFFF 85.15deg, #8D99FF 126.66deg, #FFFFFF 209.33deg, #FF6778 250.91deg, #FFFFFF 291.42deg, #C686FF 332.66deg, #FF5C5F 420.24deg);
  border-radius: inherit;
  z-index: 0;

  &::after {
    content: '';
    position: absolute;
    inset: 1px;
    backdrop-filter: blur(30px);
    border-radius: 4rem;
    background-color: rgba(255, 255, 255, 0.3);
    z-index: 0;
  }
}

.audio-controls {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  width: 100%;
  gap: 0.5rem;
  box-sizing: border-box;
}

.audio-viz {
  height: 2.4rem;
  color: var(--color-accent-action);
}
.audio-viz.main {
  width: 100%;
  height: 3rem;
}
.audio-viz-enter-active,
.audio-viz-leave-active {
  transition: all .2s;
}
.audio-viz-enter-from,
.audio-viz-leave-to {
  margin-left: calc((4px * 3 + 3px * 2 + 4px) * -1);
  opacity: 0;
}

.chat {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: end;
  flex: 1 1 auto;
  gap: 2rem;
  max-height: 100%;
  min-height: 0;
  box-sizing: border-box;
  padding: 2.4rem;
}
.chat-messages-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1 1 auto;
  color: var(--color-secondary);
}
.chat-messages {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: end;
  flex: 1 1 auto;
  max-height: 100%;
  min-height: 0;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2rem;
    background: linear-gradient(to top, rgba(#F6F6F6, 0), var(--color-bg-2));
    z-index: 1;
  }
  &::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 2rem;
    background: linear-gradient(to bottom, rgba(#F6F6F6, 0), var(--color-bg-2));
    z-index: 1;
  }
}
.chat-messages-list {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: start;
  flex: 1 1 auto;
  padding: 2rem 0;
  gap: 1rem;
  max-height: 100%;
  min-height: 0;
  overflow: auto;
}

.chat-message {
  display: flex;
  flex-direction: row;
  align-items: start;
  justify-content: start;
  max-width: 85%;
  gap: 0.5rem;
  box-sizing: border-box;

  &:first-child {
    margin-top: auto;
  }

  &-enter-active {
    transition: all .2s;
  }

  &-enter-from {
    opacity: 0;
    transform: translateY(1rem);
  }
}
.chat-message-avatar {
  display: block;
  flex: 0 0 auto;
  width: 3.2rem;
  height: 3.2rem;
  margin: 5px 0;
  border-radius: 100%;
  object-fit: cover;
}
.chat-message-content {
  flex: 1 1 auto;
  min-width: 0;
  padding: 2.4rem;
  border-radius: 2.4rem;
  background-color: var(--color-bg-1);
  font-size: 1.5rem;
  font-weight: 400;
  line-height: 1.2em;
  color: var(--color-primary);
}

.chat-message-user {
  align-self: end;
}
.chat-message-user .chat-message-content {
  background-color: var(--color-bg-action);
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

.chat-controls {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  box-sizing: border-box;
}
.chat-form {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: start;
  gap: 1.2rem;
  box-sizing: border-box;
}

.chat-form {
  display: flex;
  flex: 1 1 auto;
  flex-direction: row;
  align-items: end;
  justify-content: start;
  padding: 6px;
  gap: 0.5rem;
  box-sizing: border-box;
  border-radius: 48px;
  background-color: var(--color-bg-action);

  textarea {
    flex: 1 1 auto;
    max-width: 100%;
    min-width: 0;
    height: 48px;
    padding: 1.2rem 1.6rem;
    border-radius: 48px;
    box-sizing: border-box;
    background-color: var(--color-bg-1);
    border: 1px solid var(--color-border);
    font-family: 'Inter', Helvetica Neue, Helvetica, sans-serif;
    font-size: 1.4rem;
    font-weight: 400;
    line-height: 22px;
    color: var(--color-primary);
    outline: 0;
    box-shadow: none;
    resize: none;

    transition: all .4s;

    &:focus {
      border-color: var(--color-accent-action);
    }
  }

  button {
    flex: 0 0 auto;
    width: 48px;
    height: 48px;
    padding: 0;
    margin: 0;
    border-radius: 100%;
    background-color: var(--color-accent-action);
    color: var(--color-on-accent);
    border: 0;
    outline: 0;
    box-shadow: none;
    cursor: pointer;
  }
}
</style>


