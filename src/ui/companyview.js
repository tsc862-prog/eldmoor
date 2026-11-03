// Companies as the watcher sees them (epic #402, slice 19, issue #456). Read-only over sim/company.js; shared by the
// party frames, the follow button, the sheet and its Life view (and the Companies panel, #457).
//   followedCompany()  the company the watcher follows (S.followId, default the first), or null
//   companyLabel(C)    its name, or its members' names, or the hero's name for a solo
//   companyCols(C)     its places in order: [{slot, role, label, hero|null}]. The five-slot Fellowship keeps its role
//                      places (with empty ones and the fallen in place); any other company lists its heroes in join order
//   followedMembers()  companyCols(followedCompany())
//   frameGroups()      the frame rows in display order: the followed company first, then every company of two or more
//                      in id order, then one "Alone" row for every solo (first when the followed company is a solo)
//   followNext()       the follow cycle: the next company after the followed one (wraps); returns it
// The default together world has one company, so it reads exactly as before: one row, the five places.
import {S} from '../sim/index.js';
import {companies,followed,members,roleOf,isSolo,PARTY} from '../sim/company.js';
import {fellowshipMembers} from '../sim/fellowship.js';

export const ROLE_LABEL={tank:'Tank',healer:'Healer',dps:'DPS'};
export const MAX_HEROES=PARTY.MAX;
export const followedCompany=()=>followed();
// A company that rides as a group (two or more, or the five places of the Fellowship); a solo shares the Alone row.
export const grouped=C=>!!C&&(!!C.slots||!isSolo(C));
export function companyLabel(C){if(!C)return '';if(C.name)return C.name;const L=members(C).map(a=>a.name);
  return L.length?(L.length>2?L.slice(0,-1).join(', ')+' and '+L[L.length-1]:L.join(' and ')):'A company'}
export function companyCols(C){if(!C)return [];
  if(C.slots&&S.fellowship===C)return fellowshipMembers();
  return members(C).map(a=>{const role=roleOf(a.cls);return {slot:'h'+a.id,role,label:ROLE_LABEL[role],hero:a}})}
export const followedMembers=()=>companyCols(followedCompany());

// [{key, C|null (null for the Alone row), title, alone, followed, n (heroes), cols:[{slot, role, label, hero}]}]
export function frameGroups(){const all=companies();if(!all.length)return [];const F=followedCompany();
  const solos=all.filter(C=>!grouped(C)),groups=all.filter(grouped);
  const out=[],row=C=>({key:'c'+C.id,C,title:companyLabel(C),alone:false,followed:C===F,n:C.ids.length,cols:companyCols(C)});
  let alone=null;if(solos.length){const ord=F&&solos.includes(F)?[F,...solos.filter(C=>C!==F)]:solos;
    alone={key:'alone',C:null,title:'Alone',alone:true,followed:!!F&&solos.includes(F),n:ord.length,cols:ord.flatMap(companyCols),ids:ord.map(C=>C.id)}}
  if(alone&&alone.followed)out.push(alone);
  if(F&&groups.includes(F))out.push(row(F));
  for(const C of groups)if(C!==F)out.push(row(C));
  if(alone&&!alone.followed)out.push(alone);
  return out}
export function followNext(){const all=companies();if(!all.length)return null;const F=followedCompany(),i=all.indexOf(F);
  const N=all[(i+1)%all.length];S.followId=N.id;return N}
export function followCompany(C){if(C&&companies().includes(C))S.followId=C.id;return followedCompany()}
