import { App, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, Modal } from "obsidian";
import fetch from "node-fetch";

interface TimewebPluginSettings {
  token: string;
  agentId: string;
}

const DEFAULT_SETTINGS: TimewebPluginSettings = {
  token: "",
  agentId: ""
};

// Модалка для ввода текста/инструкции с улучшенным UI
class InstructionModal extends Modal {
  result: string | null = null;
  placeholder: string;

  constructor(app: App, placeholder: string) {
    super(app);
    this.placeholder = placeholder;
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.createEl("h3", { text: "Введите текст или инструкцию" });

    const textarea = contentEl.createEl("textarea");
    textarea.style.width = "100%";
    textarea.style.height = "100px";
    textarea.style.marginBottom = "10px";
    textarea.placeholder = this.placeholder;
    textarea.focus();

    const buttonContainer = contentEl.createDiv();
    buttonContainer.style.display = "flex";
    buttonContainer.style.justifyContent = "flex-end";
    buttonContainer.style.gap = "10px";

    const cancelBtn = buttonContainer.createEl("button", { text: "Отмена" });
    cancelBtn.onclick = () => {
      this.result = null;
      this.close();
    };

    const sendBtn = buttonContainer.createEl("button", { text: "Отправить" });
    sendBtn.onclick = () => {
      this.result = textarea.value;
      this.close();
    };

    textarea.addEventListener("keypress", (e) => {
      if (e.key === "Enter" && e.shiftKey) return; // Shift+Enter для новой строки
      if (e.key === "Enter") {
        this.result = textarea.value;
        this.close();
      }
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

export default class TimewebPlugin extends Plugin {
  settings: TimewebPluginSettings;

  async onload() {
    console.log("✅ Timeweb AI Plugin loaded");

    await this.loadSettings();

    this.addCommand({
      id: "timeweb-transform-selection",
      name: "Timeweb: Преобразовать текст (выделенный или новый)",
      editorCallback: async () => {
        if (!this.settings.token || !this.settings.agentId) {
          new Notice("⚠ Укажи токен и Agent ID в настройках");
          return;
        }

        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) {
          new Notice("⚠ Нет активного редактора");
          return;
        }

        const editorInstance = activeView.editor;

        // Сохраняем позиции выделения или курсора
        const cursorStart = editorInstance.getCursor("from");
        const cursorEnd = editorInstance.getCursor("to");
        const selectedText = editorInstance.getSelection();

        const placeholder = selectedText
          ? "Что сделать с выделенным текстом?"
          : "Введите текст для отправки";

        // Открываем модалку
        const modal = new InstructionModal(this.app, placeholder);
        modal.open();
        await new Promise<void>((resolve) => {
          modal.onClose = () => resolve();
        });

        const instructionOrText = modal.result;
        if (!instructionOrText) return;

        // ⚡ Восстанавливаем курсор сразу после закрытия модалки
        editorInstance.setSelection(cursorStart, cursorEnd);

        const textToSend = selectedText ? selectedText : instructionOrText;
        const instruction = selectedText ? instructionOrText : "Обработай текст";

        const message = `Инструкция: ${instruction}\n\nТекст:\n${textToSend}`;

        // Уведомление "Генерация..." (висит, пока не будет скрыто вручную)
        const generationNotice = new Notice("⏳ Генерация...", 0);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000); // 30 секунд

        try {
          const response = await fetch(
            `https://api.timeweb.cloud/api/v1/cloud-ai/agents/${this.settings.agentId}/call`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${this.settings.token}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({ message }),
              signal: controller.signal
            }
          );

          if (!response.ok) {
            generationNotice.hide();
            new Notice(`❌ Ошибка API: ${response.status}`);
            return;
          }

          const data = await response.json();
          const reply = data?.message ?? "❌ Нет ответа";

          // Вставка ответа в сохранённое место
          editorInstance.replaceSelection(reply);

          // Новое уведомление после вставки
          generationNotice.hide();
          new Notice("✅ Ответ вставлен в заметку", 3000); // 3 секунды
        } catch (err) {
          console.error(err);
          generationNotice.hide();
          new Notice("❌ Ошибка запроса или таймаут (30 секунд)");
        } finally {
          clearTimeout(timeout);
        }
      }
    });

    this.addSettingTab(new TimewebSettingTab(this.app, this));
  }

  onunload() {
    console.log("🛑 Timeweb AI Plugin unloaded");
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class TimewebSettingTab extends PluginSettingTab {
  plugin: TimewebPlugin;

  constructor(app: App, plugin: TimewebPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "⚙️ Настройки Timeweb AI" });

    new Setting(containerEl)
      .setName("API Token")
      .setDesc("Токен авторизации Timeweb")
      .addText((text) =>
        text
          .setPlaceholder("Введите токен")
          .setValue(this.plugin.settings.token)
          .onChange(async (value) => {
            this.plugin.settings.token = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Agent ID")
      .setDesc("ID твоего AI-агента")
      .addText((text) =>
        text
          .setPlaceholder("Введите Agent ID")
          .setValue(this.plugin.settings.agentId)
          .onChange(async (value) => {
            this.plugin.settings.agentId = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
