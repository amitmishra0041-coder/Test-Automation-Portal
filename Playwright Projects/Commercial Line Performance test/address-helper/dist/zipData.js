"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stateToZips = exports.zipToCityState = void 0;
exports.zipToCityState = {
    // Delaware
    "19701": { city: "Bear", state: "DE" },
    "19702": { city: "Newark", state: "DE" },
    "19711": { city: "Newark", state: "DE" },
    "19720": { city: "New Castle", state: "DE" },
    "19734": { city: "Middletown", state: "DE" },
    "19801": { city: "Wilmington", state: "DE" },
    "19904": { city: "Dover", state: "DE" },

    // Pennsylvania
    "17011": { city: "Camp Hill", state: "PA" },
    "17013": { city: "Carlisle", state: "PA" },
    "17050": { city: "Mechanicsburg", state: "PA" },
    "17055": { city: "Mechanicsburg", state: "PA" },
    "17101": { city: "Harrisburg", state: "PA" },
    "17601": { city: "Lancaster", state: "PA" },
    "17701": { city: "Williamsport", state: "PA" },

    // Michigan
    "48103": { city: "Ann Arbor", state: "MI" },
    "48104": { city: "Ann Arbor", state: "MI" },
    "48108": { city: "Ann Arbor", state: "MI" },
    "48301": { city: "Bloomfield Hills", state: "MI" },
    "48304": { city: "Bloomfield Hills", state: "MI" },
    "48375": { city: "Novi", state: "MI" },
    "48382": { city: "Commerce Township", state: "MI" },

    // Wisconsin
    "53005": { city: "Brookfield", state: "WI" },
    "53022": { city: "Germantown", state: "WI" },
    "53029": { city: "Hartland", state: "WI" },
    "53044": { city: "Sheboygan", state: "WI" },
    "53051": { city: "Menomonee Falls", state: "WI" },
    "53092": { city: "Mequon", state: "WI" },
    "53132": { city: "Franklin", state: "WI" },
};

exports.stateToZips = {
    DE: ["19701", "19702", "19711", "19720", "19734", "19801", "19904"],
    PA: ["17011", "17013", "17050", "17055", "17101", "17601", "17701"],
    MI: ["48103", "48104", "48108", "48301", "48304", "48375", "48382"],
    WI: ["53005", "53022", "53029", "53044", "53051", "53092", "53132"],
};