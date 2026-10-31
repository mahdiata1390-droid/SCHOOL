import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar as NativeStatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  UIManager,
  useColorScheme,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import Storage from "expo-sqlite/kv-store";
import { SQLiteProvider, useSQLiteContext } from "expo-sqlite";
import { StatusBar } from "expo-status-bar";

type Student = { id:number; name:string; points:number; created_at:string };
type History = { id:number; student_id:number; delta:number; points_after:number; created_at:string };

const themes = {
  light: { bg:"#F4F7FB", card:"#FFFFFF", card2:"#EEF2FF", text:"#101828", muted:"#667085", line:"#E4E7EC", primary:"#5B5FEF", primarySoft:"#EEF0FF", positive:"#12B76A", negative:"#F04438", gold:"#F59E0B", shadow:"#101828" },
  dark: { bg:"#080D19", card:"#121A2A", card2:"#19243A", text:"#F8FAFC", muted:"#98A2B3", line:"#27344A", primary:"#8B8FFF", primarySoft:"#24294B", positive:"#32D583", negative:"#FF6B6B", gold:"#FBBF24", shadow:"#000000" },
};

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

async function initDb(db:any) {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      points INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS point_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      delta INTEGER NOT NULL,
      points_after INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_history_student ON point_history(student_id);
  `);
}

function FloatingOrb({ color, size, top, right, delay }: {color:string;size:number;top:number;right:number;delay:number}) {
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(y,{toValue:10,duration:2200,useNativeDriver:true}),
      Animated.timing(y,{toValue:0,duration:2200,useNativeDriver:true}),
    ]));
    loop.start();
    return () => loop.stop();
  }, [delay,y]);
  return <Animated.View pointerEvents="none" style={[styles.orb,{width:size,height:size,borderRadius:size/2,backgroundColor:color,top,right,transform:[{translateY:y}]}]} />;
}

function StudentRow({ item, index, colors, onChange, onRemove }: {
  item:Student; index:number; colors:any; onChange:(s:Student,d:number)=>void; onRemove:(s:Student)=>void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const flash = useRef(new Animated.Value(0)).current;
  const initials = item.name.trim().slice(0,2).toUpperCase();

  const tap = (delta:number) => {
    Animated.sequence([
      Animated.timing(scale,{toValue:0.96,duration:70,useNativeDriver:true}),
      Animated.spring(scale,{toValue:1,useNativeDriver:true,bounciness:7}),
    ]).start();
    Animated.sequence([
      Animated.timing(flash,{toValue:1,duration:80,useNativeDriver:true}),
      Animated.timing(flash,{toValue:0,duration:260,useNativeDriver:true}),
    ]).start();
    onChange(item,delta);
  };

  return (
    <Animated.View style={[styles.student, {backgroundColor:colors.card,borderColor:colors.line,transform:[{scale}]}]}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill,{borderRadius:20,backgroundColor:deltaColor(item.points,colors),opacity:flash}]} />
      <Pressable onLongPress={()=>onRemove(item)} delayLongPress={450} style={styles.studentMain}>
        <View style={[styles.rank,{backgroundColor:index<3 ? colors.primarySoft : colors.bg}]}>
          <Text style={[styles.rankText,{color:index===0?colors.primary:index<3?colors.text:colors.muted}]}>{index+1}</Text>
        </View>
        <View style={[styles.avatar,{backgroundColor:index===0?colors.primary:colors.card2}]}>
          <Text style={[styles.avatarText,{color:index===0?"#FFF":colors.primary}]}>{initials}</Text>
        </View>
        <View style={{flex:1,minWidth:0}}>
          <Text style={[styles.studentName,{color:colors.text}]} numberOfLines={1}>{item.name}</Text>
          <View style={styles.pointLine}>
            <View style={[styles.dot,{backgroundColor:item.points>=0?colors.positive:colors.negative}]} />
            <Text style={[styles.points,{color:colors.muted}]}>{item.points} امتیاز</Text>
          </View>
        </View>
      </Pressable>
      <View style={styles.actions}>
        <Pressable hitSlop={6} onPress={()=>tap(-1)} style={[styles.action,{backgroundColor:colors.negative+"16"}]}>
          <Text style={[styles.actionText,{color:colors.negative}]}>−</Text>
        </Pressable>
        <Pressable hitSlop={6} onPress={()=>tap(1)} style={[styles.action,{backgroundColor:colors.positive+"16"}]}>
          <Text style={[styles.actionText,{color:colors.positive}]}>＋</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

function deltaColor(points:number, colors:any) { return points >= 0 ? colors.positive : colors.negative; }

function SchoolApp() {
  const db = useSQLiteContext();
  const systemScheme = useColorScheme();
  const [themeMode,setThemeMode] = useState<"system"|"light"|"dark">("system");
  const isDark = themeMode==="dark" || (themeMode==="system" && systemScheme==="dark");
  const colors = themes[isDark?"dark":"light"];
  const [students,setStudents] = useState<Student[]>([]);
  const [history,setHistory] = useState<History[]>([]);
  const [modal,setModal] = useState(false);
  const [settings,setSettings] = useState(false);
  const [name,setName] = useState("");
  const [query,setQuery] = useState("");
  const [busy,setBusy] = useState<number|null>(null);
  const [tab,setTab] = useState<"students"|"history">("students");
  const [loading,setLoading] = useState(true);

  const load = useCallback(async()=>{
    const [s,h] = await Promise.all([
      db.getAllAsync<Student>("SELECT * FROM students ORDER BY points DESC, name COLLATE NOCASE ASC"),
      db.getAllAsync<History>("SELECT * FROM point_history ORDER BY id DESC LIMIT 80"),
    ]);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setStudents(s); setHistory(h); setLoading(false);
  },[db]);

  useEffect(()=>{ load(); Storage.getItem("school.theme").then(v=>{if(v==="light"||v==="dark"||v==="system")setThemeMode(v);}); },[load]);

  const filtered = useMemo(()=>students.filter(s=>s.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),[students,query]);
  const total = students.length;
  const average = total ? Math.round(students.reduce((a,s)=>a+s.points,0)/total) : 0;
  const leader = students[0];
  const positiveCount = students.filter(s=>s.points>0).length;
  const maxPoints = Math.max(1,...students.map(s=>s.points));

  const saveTheme = async(mode:"system"|"light"|"dark")=>{
    setThemeMode(mode); await Storage.setItem("school.theme",mode);
  };

  const add = async()=>{
    const n=name.trim().replace(/\s+/g," ");
    if(!n){ Alert.alert("نام ناقص","نام دانش‌آموز را وارد کن."); return; }
    if(students.some(s=>s.name.trim().toLocaleLowerCase()===n.toLocaleLowerCase())){
      Alert.alert("نام تکراری","این دانش‌آموز قبلاً در کلاس ثبت شده."); return;
    }
    try{
      await db.runAsync("INSERT INTO students(name,points) VALUES(?,0)",n);
      setName(""); setModal(false);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await load();
    }catch(e){ Alert.alert("خطا","ثبت دانش‌آموز انجام نشد."); }
  };

  const change = async(s:Student,d:number)=>{
    if(busy===s.id) return;
    setBusy(s.id);
    const next=s.points+d;
    setStudents(prev=>prev.map(x=>x.id===s.id?{...x,points:next}:x).sort((a,b)=>b.points-a.points || a.name.localeCompare(b.name)));
    try{
      await db.withExclusiveTransactionAsync(async(txn)=>{
        await txn.runAsync("UPDATE students SET points=points+? WHERE id=?",d,s.id);
        await txn.runAsync("INSERT INTO point_history(student_id,delta,points_after) VALUES(?,?,?)",s.id,d,next);
      });
      await Haptics.impactAsync(d>0?Haptics.ImpactFeedbackStyle.Medium:Haptics.ImpactFeedbackStyle.Light);
      const h=await db.getAllAsync<History>("SELECT * FROM point_history ORDER BY id DESC LIMIT 80");
      setHistory(h);
    }catch(e){ await load(); Alert.alert("خطا","تغییر امتیاز ذخیره نشد."); }
    finally{ setBusy(null); }
  };

  const remove = (s:Student)=>{
    Alert.alert("حذف دانش‌آموز",`«${s.name}» و سابقه امتیازهایش حذف شود؟`,[
      {text:"لغو",style:"cancel"},
      {text:"حذف",style:"destructive",onPress:async()=>{
        try{
          await db.withExclusiveTransactionAsync(async(txn)=>{
            await txn.runAsync("DELETE FROM point_history WHERE student_id=?",s.id);
            await txn.runAsync("DELETE FROM students WHERE id=?",s.id);
          });
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          load();
        }catch{Alert.alert("خطا","حذف انجام نشد.");}
      }}
    ]);
  };

  const historyName = (id:number)=>students.find(s=>s.id===id)?.name || "دانش‌آموز حذف‌شده";

  return (
    <SafeAreaView style={[styles.safe,{backgroundColor:colors.bg}]}>
      <NativeStatusBar barStyle={isDark?"light-content":"dark-content"} backgroundColor={colors.bg} />
      <StatusBar style={isDark?"light":"dark"} />
      <View style={styles.container}>
        <FloatingOrb color={colors.primary+"14"} size={180} top={-65} right={-55} delay={0}/>
        <FloatingOrb color={colors.positive+"0C"} size={120} top={125} right={-35} delay={600}/>

        <View style={styles.header}>
          <View style={{flex:1}}>
            <View style={styles.brandLine}><View style={[styles.brandDot,{backgroundColor:colors.primary}]} /><Text style={[styles.eyebrow,{color:colors.primary}]}>SCHOOL • OFFLINE</Text></View>
            <Text style={[styles.title,{color:colors.text}]}>کلاس من</Text>
            <Text style={[styles.subtitle,{color:colors.muted}]}>مدیریت سریع امتیازها، بدون اینترنت.</Text>
          </View>
          <View style={styles.headerButtons}>
            <Pressable onPress={()=>setSettings(true)} style={[styles.iconButton,{backgroundColor:colors.card,borderColor:colors.line}]}><Text style={{fontSize:19}}>⚙️</Text></Pressable>
            <Pressable onPress={()=>setModal(true)} style={[styles.addTop,{backgroundColor:colors.primary}]}><Text style={styles.addTopText}>＋</Text></Pressable>
          </View>
        </View>

        <View style={[styles.hero,{backgroundColor:colors.card,borderColor:colors.line}]}>
          <View style={{flex:1}}>
            <Text style={[styles.heroLabel,{color:colors.muted}]}>امتیاز برتر کلاس</Text>
            <Text style={[styles.heroName,{color:colors.text}]} numberOfLines={1}>{leader?.name || "هنوز دانش‌آموزی نیست"}</Text>
            <View style={styles.heroScoreLine}><Text style={[styles.heroScore,{color:colors.primary}]}>{leader?.points ?? 0}</Text><Text style={[styles.heroUnit,{color:colors.muted}]}> امتیاز</Text></View>
          </View>
          <View style={[styles.trophy,{backgroundColor:colors.primarySoft}]}><Text style={{fontSize:35}}>🏆</Text></View>
        </View>

        <View style={styles.statsRow}>
          <Stat value={String(total)} label="دانش‌آموز" colors={colors}/>
          <Stat value={String(average)} label="میانگین" colors={colors}/>
          <Stat value={String(positiveCount)} label="مثبت‌ها" colors={colors}/>
        </View>

        <View style={[styles.segment,{backgroundColor:colors.card,borderColor:colors.line}]}>
          <Pressable onPress={()=>setTab("students")} style={[styles.segmentItem,tab==="students"&&{backgroundColor:colors.primary}]}><Text style={[styles.segmentText,{color:tab==="students"?"#FFF":colors.muted}]}>دانش‌آموزان</Text></Pressable>
          <Pressable onPress={()=>setTab("history")} style={[styles.segmentItem,tab==="history"&&{backgroundColor:colors.primary}]}><Text style={[styles.segmentText,{color:tab==="history"?"#FFF":colors.muted}]}>فعالیت اخیر</Text></Pressable>
        </View>

        {tab==="students" ? (
          <>
            <TextInput value={query} onChangeText={setQuery} placeholder="جستجوی نام..." placeholderTextColor={colors.muted} style={[styles.search,{backgroundColor:colors.card,color:colors.text,borderColor:colors.line}]} />
            <FlatList
              data={filtered}
              keyExtractor={x=>String(x.id)}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{paddingBottom:28}}
              ListHeaderComponent={filtered.length>0?<Text style={[styles.listCaption,{color:colors.muted}]}>{filtered.length} نفر • برای حذف، کارت را نگه دار</Text>:null}
              ListEmptyComponent={
                <View style={[styles.empty,{backgroundColor:colors.card,borderColor:colors.line}]}>
                  <View style={[styles.emptyIcon,{backgroundColor:colors.primarySoft}]}><Text style={{fontSize:34}}>🎓</Text></View>
                  <Text style={[styles.emptyTitle,{color:colors.text}]}>{loading?"در حال آماده‌سازی کلاس...":"کلاس هنوز خالی است"}</Text>
                  {!loading&&<Text style={[styles.emptyText,{color:colors.muted}]}>از دکمه + بالا اولین دانش‌آموز را اضافه کن.</Text>}
                </View>
              }
              renderItem={({item,index})=><StudentRow item={item} index={index} colors={colors} onChange={change} onRemove={remove}/>}
            />
          </>
        ) : (
          <FlatList
            data={history}
            keyExtractor={x=>String(x.id)}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{paddingBottom:28}}
            ListEmptyComponent={<View style={[styles.empty,{backgroundColor:colors.card,borderColor:colors.line}]}><Text style={{fontSize:35}}>✨</Text><Text style={[styles.emptyTitle,{color:colors.text,marginTop:10}]}>هنوز فعالیتی ثبت نشده</Text></View>}
            renderItem={({item})=>{
              const positive=item.delta>0;
              return <View style={[styles.historyRow,{backgroundColor:colors.card,borderColor:colors.line}]}>
                <View style={[styles.historyIcon,{backgroundColor:(positive?colors.positive:colors.negative)+"16"}]}><Text style={{fontSize:18}}>{positive?"＋":"−"}</Text></View>
                <View style={{flex:1}}><Text style={[styles.studentName,{color:colors.text}]} numberOfLines={1}>{historyName(item.student_id)}</Text><Text style={[styles.historyMeta,{color:colors.muted}]}>امتیاز جدید: {item.points_after}</Text></View>
                <Text style={[styles.historyDelta,{color:positive?colors.positive:colors.negative}]}>{positive?"+1":"-1"}</Text>
              </View>
            }}
          />
        )}

        <Modal visible={modal} transparent animationType="slide" onRequestClose={()=>setModal(false)}>
          <KeyboardAvoidingView behavior={Platform.OS==="ios"?"padding":undefined} style={styles.modalWrap}>
            <Pressable style={styles.backdrop} onPress={()=>setModal(false)}/>
            <View style={[styles.sheet,{backgroundColor:colors.card}]}>
              <View style={styles.grabber}/>
              <Text style={[styles.sheetTitle,{color:colors.text}]}>دانش‌آموز جدید</Text>
              <Text style={[styles.sheetHint,{color:colors.muted}]}>امتیاز اولیه صفر است و همه‌چیز فقط روی همین گوشی ذخیره می‌شود.</Text>
              <TextInput autoFocus value={name} onChangeText={setName} placeholder="مثلاً: علی رضایی" placeholderTextColor={colors.muted} style={[styles.input,{backgroundColor:colors.bg,color:colors.text,borderColor:colors.line}]} onSubmitEditing={add}/>
              <View style={styles.sheetButtons}>
                <Pressable onPress={()=>setModal(false)} style={[styles.cancel,{borderColor:colors.line}]}><Text style={[styles.cancelText,{color:colors.text}]}>لغو</Text></Pressable>
                <Pressable onPress={add} style={[styles.save,{backgroundColor:colors.primary}]}><Text style={styles.saveText}>افزودن دانش‌آموز</Text></Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        <Modal visible={settings} transparent animationType="fade" onRequestClose={()=>setSettings(false)}>
          <View style={styles.settingsWrap}>
            <Pressable style={styles.backdrop} onPress={()=>setSettings(false)}/>
            <View style={[styles.settingsCard,{backgroundColor:colors.card,borderColor:colors.line}]}>
              <Text style={[styles.sheetTitle,{color:colors.text}]}>تنظیمات</Text>
              <Text style={[styles.sheetHint,{color:colors.muted}]}>ظاهر برنامه و تجربه استفاده</Text>
              <View style={[styles.settingRow,{borderColor:colors.line}]}>
                <View style={{flex:1}}><Text style={[styles.settingTitle,{color:colors.text}]}>تم تیره</Text><Text style={[styles.settingHint,{color:colors.muted}]}>برای استفاده راحت‌تر در محیط کم‌نور</Text></View>
                <Switch value={isDark} onValueChange={v=>saveTheme(v?"dark":"light")} />
              </View>
              <Text style={[styles.settingTitle,{color:colors.text,marginTop:18,marginBottom:10}]}>تم برنامه</Text>
              <View style={styles.themeChoices}>
                {(["system","light","dark"] as const).map(mode=><Pressable key={mode} onPress={()=>saveTheme(mode)} style={[styles.themeChoice,{borderColor:themeMode===mode?colors.primary:colors.line,backgroundColor:themeMode===mode?colors.primarySoft:colors.bg}]}><Text style={[styles.themeChoiceText,{color:themeMode===mode?colors.primary:colors.text}]}>{mode==="system"?"سیستم":mode==="light"?"روشن":"تیره"}</Text></Pressable>)}
              </View>
              <View style={[styles.offlineBadge,{backgroundColor:colors.primarySoft}]}><Text style={{fontSize:16}}>🔒</Text><Text style={[styles.offlineText,{color:colors.primary}]}>داده‌ها محلی هستند؛ بدون حساب و بدون سرور.</Text></View>
              <Pressable onPress={()=>setSettings(false)} style={[styles.closeButton,{backgroundColor:colors.primary}]}><Text style={styles.saveText}>بستن</Text></Pressable>
            </View>
          </View>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

function Stat({value,label,colors}:{value:string;label:string;colors:any}) {
  return <View style={[styles.stat,{backgroundColor:colors.card,borderColor:colors.line}]}><Text style={[styles.statNumber,{color:colors.text}]}>{value}</Text><Text style={[styles.statLabel,{color:colors.muted}]}>{label}</Text></View>;
}

export default function App(){
  return <SQLiteProvider databaseName="school.db" onInit={initDb}><SchoolApp/></SQLiteProvider>;
}

const styles=StyleSheet.create({
  safe:{flex:1},
  container:{flex:1,paddingHorizontal:18,overflow:"hidden"},
  orb:{position:"absolute"},
  header:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",paddingTop:12,paddingBottom:15},
  brandLine:{flexDirection:"row",alignItems:"center",gap:6},
  brandDot:{width:7,height:7,borderRadius:4},
  eyebrow:{fontSize:10,fontWeight:"900",letterSpacing:1.5},
  title:{fontSize:30,fontWeight:"900",marginTop:3},
  subtitle:{fontSize:11,marginTop:3},
  headerButtons:{flexDirection:"row",gap:8},
  iconButton:{width:46,height:46,borderRadius:16,borderWidth:1,alignItems:"center",justifyContent:"center"},
  addTop:{width:46,height:46,borderRadius:16,alignItems:"center",justifyContent:"center"},
  addTopText:{color:"#FFF",fontSize:28,fontWeight:"300",marginTop:-2},
  hero:{minHeight:116,borderRadius:24,borderWidth:1,padding:18,flexDirection:"row",alignItems:"center",marginBottom:10},
  heroLabel:{fontSize:10,fontWeight:"700"},
  heroName:{fontSize:20,fontWeight:"900",marginTop:3},
  heroScoreLine:{flexDirection:"row",alignItems:"baseline",marginTop:4},
  heroScore:{fontSize:25,fontWeight:"900"},
  heroUnit:{fontSize:11,fontWeight:"700"},
  trophy:{width:68,height:68,borderRadius:22,alignItems:"center",justifyContent:"center"},
  statsRow:{flexDirection:"row",gap:8,marginBottom:10},
  stat:{flex:1,paddingVertical:11,paddingHorizontal:12,borderRadius:17,borderWidth:1},
  statNumber:{fontSize:20,fontWeight:"900"},
  statLabel:{fontSize:10,marginTop:2,fontWeight:"600"},
  segment:{height:46,borderRadius:16,borderWidth:1,padding:4,flexDirection:"row",marginBottom:10},
  segmentItem:{flex:1,borderRadius:12,alignItems:"center",justifyContent:"center"},
  segmentText:{fontSize:12,fontWeight:"900"},
  search:{height:45,borderRadius:15,borderWidth:1,paddingHorizontal:14,fontSize:13,marginBottom:8},
  listCaption:{fontSize:10,fontWeight:"700",marginBottom:8,marginHorizontal:3},
  student:{minHeight:78,borderRadius:20,borderWidth:1,padding:10,marginBottom:8,flexDirection:"row",alignItems:"center",gap:8,overflow:"hidden"},
  studentMain:{flex:1,flexDirection:"row",alignItems:"center",gap:8,minWidth:0},
  rank:{width:27,height:27,borderRadius:9,alignItems:"center",justifyContent:"center"},
  rankText:{fontSize:11,fontWeight:"900"},
  avatar:{width:45,height:45,borderRadius:15,alignItems:"center",justifyContent:"center"},
  avatarText:{fontSize:16,fontWeight:"900"},
  studentName:{fontSize:14,fontWeight:"900"},
  pointLine:{flexDirection:"row",alignItems:"center",gap:5,marginTop:4},
  dot:{width:6,height:6,borderRadius:3},
  points:{fontSize:10,fontWeight:"700"},
  actions:{flexDirection:"row",gap:6},
  action:{width:38,height:38,borderRadius:13,alignItems:"center",justifyContent:"center"},
  actionText:{fontSize:22,fontWeight:"900"},
  empty:{borderRadius:24,borderWidth:1,alignItems:"center",paddingVertical:42,paddingHorizontal:25,marginTop:8},
  emptyIcon:{width:70,height:70,borderRadius:24,alignItems:"center",justifyContent:"center",marginBottom:12},
  emptyTitle:{fontSize:16,fontWeight:"900"},
  emptyText:{fontSize:11,marginTop:5,textAlign:"center"},
  historyRow:{minHeight:70,borderRadius:18,borderWidth:1,padding:11,marginBottom:8,flexDirection:"row",alignItems:"center",gap:10},
  historyIcon:{width:40,height:40,borderRadius:14,alignItems:"center",justifyContent:"center"},
  historyMeta:{fontSize:10,marginTop:3},
  historyDelta:{fontSize:15,fontWeight:"900"},
  modalWrap:{flex:1,justifyContent:"flex-end"},
  settingsWrap:{flex:1,alignItems:"center",justifyContent:"center",padding:20},
  backdrop:{...StyleSheet.absoluteFillObject,backgroundColor:"#00000088"},
  sheet:{borderTopLeftRadius:30,borderTopRightRadius:30,padding:22,paddingBottom:30},
  grabber:{width:42,height:5,borderRadius:3,backgroundColor:"#98A2B3",alignSelf:"center",marginBottom:18,opacity:.5},
  sheetTitle:{fontSize:23,fontWeight:"900"},
  sheetHint:{fontSize:11,marginTop:5,marginBottom:17,lineHeight:18},
  input:{height:52,borderRadius:16,borderWidth:1,paddingHorizontal:15,fontSize:15},
  sheetButtons:{flexDirection:"row",gap:10,marginTop:15},
  cancel:{flex:1,height:50,borderRadius:15,borderWidth:1,alignItems:"center",justifyContent:"center"},
  cancelText:{fontWeight:"800"},
  save:{flex:2,height:50,borderRadius:15,alignItems:"center",justifyContent:"center"},
  saveText:{color:"#FFF",fontWeight:"900"},
  settingsCard:{width:"100%",maxWidth:420,borderRadius:28,borderWidth:1,padding:22},
  settingRow:{marginTop:18,paddingTop:16,borderTopWidth:1,flexDirection:"row",alignItems:"center"},
  settingTitle:{fontSize:14,fontWeight:"900"},
  settingHint:{fontSize:10,marginTop:3,lineHeight:16},
  themeChoices:{flexDirection:"row",gap:8},
  themeChoice:{flex:1,height:44,borderRadius:14,borderWidth:1,alignItems:"center",justifyContent:"center"},
  themeChoiceText:{fontSize:11,fontWeight:"900"},
  offlineBadge:{marginTop:18,borderRadius:15,padding:12,flexDirection:"row",alignItems:"center",gap:8},
  offlineText:{fontSize:10,fontWeight:"700",flex:1},
  closeButton:{height:48,borderRadius:15,alignItems:"center",justifyContent:"center",marginTop:12},
});
