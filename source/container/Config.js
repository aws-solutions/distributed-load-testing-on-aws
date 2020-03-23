export const config = JSON.parse(
    open("./config.json")
        // 1) Replace "/" inside quotes with non-printable ASCII '\x01' char
        .replace(/("([^\\"]|\\")*")|('([^\\']|\\')*')/g, (m) => m.replace(/\//g, '\x01'))
        // 2) Remove comments
        .replace(/(\/\*[^*]+\*\/)|(\/\/[^\n]*)/g, '')
        // 3) Restore "/" inside quotes
        .replace(/\x01/g, '/')
);
