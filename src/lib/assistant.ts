import type { MaybeRef } from 'vue';
import { ref, toRef, watchEffect, watch } from 'vue';
import { tryOnScopeDispose } from '@vueuse/core';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AssistantTool<T = any, R = any> = {
  type: 'function';
  name: string;
  description?: string;
  parameters: object;
  call: (args: T) => Promise<R>;
}

export type AssistantMessageEvent = {
  type: 'message';
  id: string;
  role: 'user' | 'assistant';
  text: string;
} | {
  type: 'message_part';
  id: string;
  role: 'user' | 'assistant';
  textDelta: string;
} | {
  type: 'typing';
};

export type OpenAIUsage = {
  input_token_details: {
    audio_tokens: number;
    text_tokens: number;
    cached_tokens: number;
    cached_tokens_details: {
      audio_tokens: number;
      text_tokens: number;
    };
  };
  output_token_details: {
    audio_tokens: number;
    text_tokens: number;
  };
};

export type AssistantConfig = {
  type: 'realtime';
  model: string;
  instructions: string;
  tools: AssistantTool[];
  tool_choice?: 'auto' | 'none' | 'required';

  output_modalities: ['audio' | 'text'];

  max_response_output_tokens?: number;

  audio?: {
    input?: {
      format?: {
        type: string;
        rate?: number;
      };
      noise_reduction?: {
        type: 'near_field' | 'far_field';
      };
      transcription?: {
        model: string;
        prompt?: string;
        language?: string;
      };
      turn_detection?: {
        type?: 'server_vad';
        create_response?: boolean;
        interrupt_response?: boolean;
        idle_timeout_ms?: number | null;
        prefix_padding_ms?: number;
        silence_duration_ms?: number;
        threshold?: number;
      } | {
        type?: 'semantic_vad';
        create_response?: boolean;
        interrupt_response?: boolean;
        eagerness?: 'low' | 'medium' | 'high' | 'auto';
      };
    };
    output?: {
      format?: {
        type: string;
        rate?: number;
      };
      speed?: number;
      voice?: string;
    };
  };

  tracing?: 'auto' | object;
  truncation?: string | object;
};

export function useAssistant(
  config: MaybeRef<AssistantConfig>,
  token: string | (() => Promise<string>),
  input: MaybeRef<MediaStream | null>,
  speakOnReady: boolean = true,
  onMessageEvent?: (event: AssistantMessageEvent) => void,
  onUsageEvent?: (conversationId: string, startTime: number | null, usage: OpenAIUsage | null) => void,
) {
  const audioInput = toRef(input);
  const audioOutput = ref<MediaStream | null>(null);

  const disconnected = ref(true);
  const connecting = ref(false);
  const ready = ref(false);
  const reconnectAttempts = ref(0);
  const connectionState = ref<RTCIceConnectionState | 'disconnected'>('disconnected');

  let peerConnection: RTCPeerConnection | null = null;
  let dataChannel: RTCDataChannel | null = null;
  let reconnectTimeout: number | null = null;
  let startTime: number | null = null;

  const assistantConfig = toRef(config);
  let watchers: (() => void)[] = [];

  async function connect(system = false) {
    if (!system) {
      disconnected.value = false;
    }

    try {
      if (disconnected.value) return;
      if (connecting.value) return;
      // if (!audioInput.value) return;
      connecting.value = true;
      ready.value = false;
      startTime = null;

      await disconnect(true);

      peerConnection = new RTCPeerConnection();

      peerConnection.ontrack = (event) => {
        audioOutput.value = event.streams[0];
      };

      peerConnection.oniceconnectionstatechange = () => {
        connectionState.value = peerConnection?.iceConnectionState || 'disconnected';
      };

      dataChannel = peerConnection.createDataChannel('oai-events');

      dataChannel.addEventListener('open', () => {
        console.log('Data channel open');
        reconnectAttempts.value = 0;

        watchers.push(watch(assistantConfig, (session) => {
          console.log('Session updated', session);

          dataChannel?.send(JSON.stringify({
            type: 'session.update',
            session,
          }));

          if (!ready.value && speakOnReady) {
            dataChannel?.send(JSON.stringify({
              type: 'response.create',
            }));
          }

          ready.value = true;
        }, {
          immediate: true,
        }));
      });

      dataChannel.addEventListener('close', () => {
        console.warn('Data channel closed => reconnecting...');
        connectionState.value = 'disconnected';
      });

      dataChannel.addEventListener('message', async (ev) => {
        const msg = JSON.parse(ev.data);
        const RESPONSE_DELAY = 250;

        if (msg.type === 'error') {
          console.log('Session error', msg);
        }

        if (msg.type === 'session.created' || msg.type === 'session.updated') {
          startTime = Date.now();
        }

        if (msg.type === 'response.created') {
          onMessageEvent?.({ type: 'typing' });
        }

        if (msg.type === 'response.done') {
          onUsageEvent?.(msg.response.conversation_id, startTime, msg.response.usage);
        }

        if (msg.type === 'response.text.delta') {
          onMessageEvent?.({
            type: 'message_part',
            id: msg.response_id,
            role: 'assistant',
            textDelta: msg.delta
          });
        }

        if (msg.type === 'response.output_item.done' && msg.item.type === 'message' && msg.item?.content) {
          onMessageEvent?.({
            type: 'message',
            id: msg.response_id,
            role: 'assistant',
            text: msg.item.content.map((content: { transcript?: string; text?: string }) => content.transcript || content.text).join('\n\n')
          });
        }

        if (msg.type === 'conversation.item.input_audio_transcription.completed' && msg.transcript) {
          onMessageEvent?.({
            type: 'message',
            id: msg.response_id || new Date().toJSON(),
            role: 'user',
            text: msg.transcript
          });
        }

        if (msg.type === 'response.function_call_arguments.done') {
          try {
            const args = JSON.parse(msg.arguments);
            console.log(msg.name, args);

            const fns = Object.fromEntries(
              assistantConfig.value.tools.map(tool => [tool.name, tool.call]),
            );

            const result = msg.name in fns
              ? await fns[msg.name as keyof typeof fns](args)
              : { success: true };

            dataChannel?.send(JSON.stringify({
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: msg.call_id,
                output: JSON.stringify(result),
              },
            }));
          } catch (error) {
            console.error(error);

            dataChannel?.send(JSON.stringify({
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: msg.call_id,
                output: JSON.stringify(error),
              },
            }));
          }

          setTimeout(() => {
            dataChannel?.send(JSON.stringify({ type: 'response.create' }));
          }, RESPONSE_DELAY);
        }
      });

      let sender: RTCRtpSender | undefined;

      watchers.push(watchEffect(() => {
        let track: MediaStreamTrack;

        if (audioInput.value) {
          track = audioInput.value.getAudioTracks()[0];
        } else {
          const audioContext = new AudioContext();
          const destination = audioContext.createMediaStreamDestination();
          track = destination.stream.getAudioTracks()[0];
        }

        if (sender) {
          sender.replaceTrack(track)
        } else {
          sender = peerConnection?.addTrack(track);
        }
      }));

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      const clientSecret = typeof token === 'string'
        ? await fetch('https://api.openai.com/v1/realtime/client_secrets', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ session: assistantConfig.value }),
        })
          .then(res => res.json() as Promise<{ value: string; expires_at: number; }>)
          .then(data => data.value)
        : await token();

      const response = await fetch(`https://api.openai.com/v1/realtime/calls?model=${assistantConfig.value.model}`, {
        method: "POST",
        body: offer.sdp,
        headers: {
          'Authorization': `Bearer ${clientSecret}`,
          'Content-Type': 'application/sdp',
        },
      });

      if (!response.ok) {
        throw new Error(`SDP exchange failed: ${response.status}`);
      }

      const answer = await response.text();

      await peerConnection.setRemoteDescription({
        sdp: answer,
        type: 'answer',
      });

    } catch (error) {
      console.error('Connection error:', error);
      scheduleReconnect();
    } finally {
      connecting.value = false;
    }
  }

  async function disconnect(system = false) {
    watchers.forEach(watcher => watcher());
    watchers = [];

    if (!system) {
      disconnected.value = true;
    }

    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }

    if (dataChannel) {
      dataChannel.removeEventListener('open', () => { });
      dataChannel.removeEventListener('message', () => { });
      dataChannel.removeEventListener('close', () => { });
      dataChannel.close();
      dataChannel = null;
    }

    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }

    audioOutput.value = null;
    ready.value = false;
  }

  function scheduleReconnect() {
    if (connecting.value) return;

    // Max delay of 10 seconds
    // eslint-disable-next-line no-magic-numbers
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.value), 10000);
    reconnectAttempts.value++;

    console.log(`Scheduling reconnect in ${delay} ms`);

    reconnectTimeout = window.setTimeout(() => {
      connect(true);
    }, delay);
  }

  function sendMessage(message: string) {
    dataChannel?.send(JSON.stringify({ type: 'output_audio_buffer.clear' }));

    dataChannel?.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text: message,
        }],
      },
    }));

    dataChannel?.send(JSON.stringify({ type: 'response.create' }));
  }

  function startMessage() {
    if (!speakOnReady) {
      if (ready.value) {
        dataChannel?.send(JSON.stringify({
          type: 'response.create',
        }));
        return;
      }

      let done = watch(ready, (isReady) => {
        if (isReady) {
          dataChannel?.send(JSON.stringify({
            type: 'response.create',
          }));
          done();
        }
      });
    }
  }

  function createResponse(message?: string | null) {
    if (message) {
      // Добавляем системное сообщение о том, что пользователь вернулся к разговору
      dataChannel?.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'system',
          content: [{
            type: 'input_text',
            text: message,
          }],
        },
      }));
    }

    dataChannel?.send(JSON.stringify({
      type: 'response.create',
    }));
  }

  function resumeConversation(message?: string | null) {
    if (ready.value) {
      createResponse(message);
      return;
    }

    let done = watch(ready, (isReady) => {
      if (isReady) {
        createResponse(message);
        done();
      }
    });
  }

  watch(connectionState, (value) => {
    if (value === 'failed' || value === 'disconnected' || value === 'closed') {
      scheduleReconnect();
    }
  });

  tryOnScopeDispose(disconnect);

  return {
    connect,
    disconnect,
    audioOutput,
    ready,
    connecting,
    connectionState,
    sendMessage,
    startMessage,
    resumeConversation,
  };
}
