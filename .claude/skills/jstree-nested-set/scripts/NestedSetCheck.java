// jstree 포트 NestedSetTree 를 H2 메모리 DB 위에서 직접 돌려 연산 결과(lft/rgt/lvl/pid/pos)와 analyze 를 출력한다.
// references/algorithms.md 의 예시 값이 이 출력이다. 가설 검증용 — 운영 코드가 아니다.
// 원본(C:\dev\jstree-3.3.3)은 건드리지 말고 사본을 빌드한다(Java 17 + Maven):
//   cp -r /c/dev/jstree-3.3.3/jstree-3.3.3/java-backend <scratch>/ && cd <scratch>/java-backend && mvn -o -q -DskipTests package
//   mkdir ex && cd ex && jar xf ../target/jstree-demo-backend-3.3.3.jar && cd ..
//   java -cp "ex/BOOT-INF/classes;ex/BOOT-INF/lib/*" <이 파일 경로>      (Windows 구분자 ';', 그 외 ':')
// NestedSetTree 를 프록시 없이 만들므로 @Transactional 은 적용되지 않는다(단일 스레드 검증에는 무관).
import com.jstree.demo.sitebrowser.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
public class NestedSetCheck {
  static JdbcTemplate db; static NestedSetTree t;
  static void reset() {
    db.execute("DROP ALL OBJECTS");
    db.execute("CREATE TABLE tree_data (id BIGINT PRIMARY KEY, nm VARCHAR(255) NOT NULL)");
    db.execute("CREATE TABLE tree_struct (id BIGINT AUTO_INCREMENT PRIMARY KEY, lft BIGINT NOT NULL, rgt BIGINT NOT NULL, lvl INT NOT NULL, pid BIGINT NOT NULL, pos INT NOT NULL)");
    db.execute("INSERT INTO tree_data VALUES (1,'root'),(2,'A'),(3,'A1'),(4,'A2'),(5,'B')");
    db.execute("INSERT INTO tree_struct VALUES (1,1,10,0,0,0),(2,2,7,1,1,0),(3,3,4,2,2,0),(4,5,6,2,2,1),(5,8,9,1,1,1)");
    db.execute("ALTER TABLE tree_struct ALTER COLUMN id RESTART WITH 6");
  }
  static void dump(String title) {
    System.out.println("== " + title);
    db.query("SELECT s.*, d.nm FROM tree_struct s LEFT JOIN tree_data d ON s.id=d.id ORDER BY lft", rs -> {
      System.out.printf("  %-4s id=%d (%d,%d) lvl=%d pid=%d pos=%d%n", rs.getString("nm"), rs.getLong("id"), rs.getLong("lft"), rs.getLong("rgt"), rs.getInt("lvl"), rs.getLong("pid"), rs.getInt("pos"));
    });
    System.out.println("  analyze=" + t.analyze());
  }
  public static void main(String[] a) {
    DriverManagerDataSource ds = new DriverManagerDataSource("jdbc:h2:mem:t;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1", "sa", "");
    db = new JdbcTemplate(ds); t = new NestedSetTree(db, "tree_struct", "tree_data");
    reset(); dump("T0");
    reset(); t.mk(2, 1, "new"); dump("mk(parent=A, pos=1)");
    reset(); t.mv(3, 2, 1); dump("mv(A1 -> A, pos=1) same parent");
    reset(); t.mv(5, 2, 0); dump("mv(B -> A, pos=0)");
    reset(); t.rm(2); dump("rm(A)");
    reset(); t.cp(2, 5, 0); dump("cp(A -> B, pos=0)");
    reset(); try { t.mv(2, 3, 0); } catch (Exception e) { System.out.println("== mv(A -> A1): " + e.getMessage()); }
    // broken tree for analyze
    reset(); db.update("UPDATE tree_struct SET pos=0 WHERE id=4"); db.update("UPDATE tree_struct SET rgt=11 WHERE id=1"); dump("broken: A2.pos=0, root.rgt=11");
    t.reconstruct(); dump("after reconstruct");
  }
}
