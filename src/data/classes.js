// Hero classes: base stats, attack range and sprite palette. Owned by character-builder.
export const CLS={
  Warrior:{hp:62,atk:7,range:1.1,acc:'#c0c4d4',head:'#8a8e9c',wep:'#d8dce8',arm:.8},
  Mage:{hp:40,atk:10,range:3.2,acc:'#6fc3ff',head:'#3a5ab8',wep:'#8a5a32',orb:'#8ad8ff'},
  Hunter:{hp:48,atk:8,range:3.5,acc:'#7dbb4a',head:'#4e6e2c',wep:'#8a5a2a'},
  Priest:{hp:46,atk:6,range:2.6,acc:'#f0ecd8',head:'#e8e0c0',wep:'#f0e6b0',orb:'#ffe68a',heal:true},
  Rogue:{hp:50,atk:8,range:1.1,acc:'#e6d24a',head:'#2e2a30',wep:'#c8c8d0',crit:.25},
};
export const CLSN=Object.keys(CLS);
