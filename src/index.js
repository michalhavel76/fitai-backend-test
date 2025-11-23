"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var express_1 = require("express");
var app = (0, express_1.default)();
var PORT = process.env.PORT || 8080;
app.get("/ping", function (req, res) {
    res.status(200).json({ status: "ok" });
});
app.listen(PORT, "0.0.0.0", function () {
    console.log("\uD83D\uDE80 Mini-backend b\u011B\u017E\u00ED na portu ".concat(PORT));
});
