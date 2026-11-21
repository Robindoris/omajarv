// Line diff for the Files save review. Bounded inputs: whole replace above MAX_LINES to keep the LCS table small.
const MAX_LINES=4000;
const lines=text=>text?text.split('\n'):[];
export function lineDiff(oldText,newText){
 const a=lines(oldText),b=lines(newText);
 if(!a.length&&!b.length)return [];
 if(a.length+b.length>MAX_LINES)return [...a.map(text=>({type:'-',text})),...b.map(text=>({type:'+',text}))];
 let start=0;while(start<a.length&&start<b.length&&a[start]===b[start])start++;
 let endA=a.length,endB=b.length;while(endA>start&&endB>start&&a[endA-1]===b[endB-1]){endA--;endB--;}
 const ops=[];
 for(let i=0;i<start;i++)ops.push({type:' ',text:a[i]});
 const m=endA-start,n=endB-start;
 if(m&&n){
  const width=n+1,dp=new Uint16Array((m+1)*width),dir=new Uint8Array(m*width);
  for(let i=m-1;i>=0;i--)for(let j=n-1;j>=0;j--){
   if(a[start+i]===b[start+j]){dp[i*width+j]=dp[(i+1)*width+j+1]+1;dir[i*width+j]=3;}
   else if(dp[(i+1)*width+j]>=dp[i*width+j+1]){dp[i*width+j]=dp[(i+1)*width+j];dir[i*width+j]=1;}
   else {dp[i*width+j]=dp[i*width+j+1];dir[i*width+j]=2;}
  }
  let i=0,j=0;
  while(i<m&&j<n){const d=dir[i*width+j];
   if(d===3){ops.push({type:' ',text:a[start+i]});i++;j++;}
   else if(d===1){ops.push({type:'-',text:a[start+i]});i++;}
   else {ops.push({type:'+',text:b[start+j]});j++;}}
  while(i<m){ops.push({type:'-',text:a[start+i]});i++;}
  while(j<n){ops.push({type:'+',text:b[start+j]});j++;}
 }else{
  for(let k=start;k<endA;k++)ops.push({type:'-',text:a[k]});
  for(let k=start;k<endB;k++)ops.push({type:'+',text:b[k]});
 }
 for(let k=endA;k<a.length;k++)ops.push({type:' ',text:a[k]});
 return ops;
}
export function diffSummary(ops){let added=0,removed=0;for(const op of ops){if(op.type==='+')added++;else if(op.type==='-')removed++;}return {added,removed};}
