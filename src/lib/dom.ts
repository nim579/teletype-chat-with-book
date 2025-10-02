import { useEventListener } from "@vueuse/core";
import { type MaybeRef, ref, toRef, watch } from "vue";

export const useTextareaRows = (
  textarea: MaybeRef<HTMLTextAreaElement | null>,
  maxRows: number = 5
) => {
  const rows = ref(1);

  const textareaRef = toRef(textarea)
  const text = ref(textareaRef.value?.value || '');

  useEventListener(textareaRef, 'input', () => {
    text.value = textareaRef.value?.value || '';
  });

  watch(
    () => [
      textareaRef.value,
      text.value
    ],
    (value) => {
      // Подсчитываем явные переносы строк
      const explicitLineBreaks = (text.value.match(/\n/g) || []).length;
      let totalRows = explicitLineBreaks + 1;

      // Если есть доступ к textarea, учитываем автоматические переносы
      if (textareaRef.value) {
        const style = window.getComputedStyle(textareaRef.value);
        const paddingLeft = parseFloat(style.paddingLeft);
        const paddingRight = parseFloat(style.paddingRight);
        const textareaWidth = textareaRef.value.clientWidth - paddingLeft - paddingRight;

        // Создаем временный элемент для измерения ширины текста
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        if (context) {
          context.font = style.font;

          // Разбиваем текст на строки и проверяем каждую
          const lines = text.value.split('\n');
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

      rows.value = Math.min(totalRows, maxRows);
    },
    {
      immediate: true,
    },
  )

  return rows;
}
