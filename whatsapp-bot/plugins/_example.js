module.exports = {
  name: "example",
  description: "Plugin example. Rename file (hapus _ prefix) untuk aktivasi.",
  commands: [
    {
      name: "/ping",
      handler: async (ctx) => {
        return { reply: `🏓 Pong! Plugin example aktif.` };
      }
    }
  ],
  onMessage: async (ctx) => {
  }
};
