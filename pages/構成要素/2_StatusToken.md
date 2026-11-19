# StatusToken
## 概要
　StatusVectorというステータスをつかさどる行列を作成したことで、StatusVectorのやり取りというのは「**与える側のStatusを参照して、受ける側のStatusを変更する**」という設計に落とし込める。  
　ここで**StatusToken**は与える側のStatus行列から必要な値を抽出保持し、受ける側がそのデータを元に自身のStatus行列を変更するためのものとして設定した。  
　本実装では、ポリモーフィズムを利用することで、新しくTokenを作成しても使用する側のコードは変更する必要がないようにした。抽象クラスを作成し、それを継承することで種類を増やす構造を採用した。  
  

*StatusTokenの抽象クラス*
```csharp
public abstract class StatusToken
{
    // ExtractStatusメソッドは与える側が実行、Statusを抽出する。
    public abstract void ExtractStatus(in StatusVector s);

    public void Execute(in StatusVector target, StatusVector modified)
    {
        modified.Validate();
        Calculate(target, modified);
    }

    // Calculateメソッドは受ける側が実行、Statusを変更する。modifiedは計算されたvector
    public abstract void Calculate(in StatusVector target, StatusVector modified);
}

/*
このクラスを継承し、
ExtractStatusメソッドとCalculateメソッドをオーバーライドすることで
特有のStatusのやり取りを定義する。
*/
```
  
*DamageTokenのクラス（StatusTokenを継承）*
```csharp
public class DamageToken : StatusToken
{
    float sourceAttack = 0f;
    public override void ExtractStatus(in StatusVector s)
    {
        sourceAttack += s.Calculate(StatusCategory.Attack);
    }
    public override void Calculate(in StatusVector target, StatusVector modified)
    {
        float targetDefense = modified.Calculate(StatusCategory.Defense);
        float damage = sourceAttack - targetDefense;
        if (damage < 0) { damage = 0; }
        target.Add(StatusCategory.HP, StatusMethod.Base, -damage);
    }
}

// ExtractStatusメソッドでは計算された攻撃値を取得する。
// Calculateメソッドで、おかしくならないようにダメージ計算
/*
DamageToken dt = new();
dt.ExtractStatus(statusVector);
この書き方で抽出することができる。
*/
```
　本実装では**StatusContainer**と呼ばれるクラスがあり、そこでTokenの適用などをする。  

　このように、与える側でStatusTokenのインスタンスを生成し、受ける側でそのインスタンスを消費する形にすることで、ゲームの趣旨に応じたステータスのやり取りを実現することができる。  

　また、このStatusTokenによってStatusVectorのやり取りの時に相手のStatusVector自体を知る必要がなくなるので、やり取り時のnull参照によるエラーは基本的に発生しない。

## Tokenリレー
　StatusTokenは一つだけではなく、複数個発行することもでき、様々なオブジェクトに保持させて伝搬させていけば遠くのエンティティーや複数のエンティティーとStatusのやり取りができる。このTokenの運搬を**Tokenリレー**と呼び、遠距離武器などのplayerから独立したオブジェクトにもバフの効果を間接的に持たせるために用いている。  

*弓矢による攻撃*